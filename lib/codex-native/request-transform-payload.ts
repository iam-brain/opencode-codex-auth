import type { BehaviorSettings } from "../config.js"
import type { CodexModelInfo } from "../model-catalog.js"
import { getRuntimeDefaultsForModel } from "../model-catalog.js"
import { sanitizeRequestPayloadForCompat } from "../compat-sanitizer.js"
import { isRecord } from "../util.js"
import { applyGpt54LongContextClampsToPayload } from "./request-transform-gpt54-limits.js"
import {
  applyResolvedCodexRuntimeDefaults,
  findCatalogModelForCandidates,
  getModelLookupCandidates,
  getModelThinkingSummariesOverride,
  getModelVerbosityEnabledOverride,
  getModelVerbosityOverride
} from "./request-transform-model.js"
import { getRequestBodyVariantCandidates, resolveServiceTierForModel } from "./request-transform-model-service-tier.js"
import { asString, normalizeVerbositySetting } from "./request-transform-shared.js"
import {
  type CompatSanitizerTransformResult,
  type DeveloperRoleRemapTransformResult,
  type PromptCacheKeyTransformResult,
  type ReplayTransformResult,
  applyPromptCacheKeyOverrideToPayload,
  rebuildRequestWithJsonBody,
  remapDeveloperMessagesToUserOnPayload,
  stripReasoningReplayFromPayload
} from "./request-transform-payload-helpers.js"

type OutboundRequestPayloadTransformInput = {
  request: Request
  stripReasoningReplayEnabled: boolean
  remapDeveloperMessagesToUserEnabled: boolean
  compatInputSanitizerEnabled: boolean
  promptCacheKeyOverrideEnabled: boolean
  gpt54LongContextClampEnabled?: boolean
  promptCacheKeyOverride?: string
  catalogModels?: CodexModelInfo[]
  behaviorSettings?: BehaviorSettings
}

export type OutboundRequestPayloadTransformResult = {
  request: Request
  changed: boolean
  replay: ReplayTransformResult
  developerRoleRemap: DeveloperRoleRemapTransformResult
  promptCacheKey: PromptCacheKeyTransformResult
  compatSanitizer: CompatSanitizerTransformResult
  serviceTier: ServiceTierTransformResult
}

export type ServiceTierTransformResult = {
  request: Request
  changed: boolean
  reason: string
  serviceTier?: string
}

export async function sanitizeOutboundRequestIfNeeded(
  request: Request,
  enabled: boolean
): Promise<{ request: Request; changed: boolean }> {
  const transformed = await transformOutboundRequestPayload({
    request,
    stripReasoningReplayEnabled: false,
    remapDeveloperMessagesToUserEnabled: false,
    compatInputSanitizerEnabled: enabled,
    promptCacheKeyOverrideEnabled: false,
    gpt54LongContextClampEnabled: false
  })
  return {
    request: transformed.request,
    changed: transformed.compatSanitizer.changed
  }
}

export async function transformOutboundRequestPayload(
  input: OutboundRequestPayloadTransformInput
): Promise<OutboundRequestPayloadTransformResult> {
  const disabledReplay: ReplayTransformResult = {
    changed: false,
    reason: "disabled",
    removedPartCount: 0,
    removedFieldCount: 0
  }
  const disabledRoleRemap: DeveloperRoleRemapTransformResult = {
    changed: false,
    reason: "disabled",
    remappedCount: 0,
    preservedCount: 0
  }
  const disabledPromptCacheKey: PromptCacheKeyTransformResult = {
    changed: false,
    reason: "disabled"
  }
  const disabledCompatSanitizer: CompatSanitizerTransformResult = {
    changed: false,
    reason: "disabled"
  }
  const disabledServiceTier: ServiceTierTransformResult = {
    request: input.request,
    changed: false,
    reason: "disabled"
  }

  const method = input.request.method.toUpperCase()
  if (method !== "POST") {
    return {
      request: input.request,
      changed: false,
      replay: input.stripReasoningReplayEnabled ? { ...disabledReplay, reason: "non_post" } : disabledReplay,
      developerRoleRemap: input.remapDeveloperMessagesToUserEnabled
        ? { ...disabledRoleRemap, reason: "non_post" }
        : disabledRoleRemap,
      promptCacheKey: input.promptCacheKeyOverrideEnabled
        ? { ...disabledPromptCacheKey, reason: "non_post" }
        : disabledPromptCacheKey,
      compatSanitizer: input.compatInputSanitizerEnabled
        ? { ...disabledCompatSanitizer, reason: "non_post" }
        : disabledCompatSanitizer,
      serviceTier: input.behaviorSettings ? { ...disabledServiceTier, reason: "non_post" } : disabledServiceTier
    }
  }

  let raw: string
  try {
    raw = await input.request.clone().text()
  } catch {
    return {
      request: input.request,
      changed: false,
      replay: input.stripReasoningReplayEnabled ? { ...disabledReplay, reason: "invalid_json" } : disabledReplay,
      developerRoleRemap: input.remapDeveloperMessagesToUserEnabled
        ? { ...disabledRoleRemap, reason: "invalid_json" }
        : disabledRoleRemap,
      promptCacheKey: input.promptCacheKeyOverrideEnabled
        ? { ...disabledPromptCacheKey, reason: "invalid_json" }
        : disabledPromptCacheKey,
      compatSanitizer: input.compatInputSanitizerEnabled
        ? { ...disabledCompatSanitizer, reason: "invalid_json" }
        : disabledCompatSanitizer,
      serviceTier: input.behaviorSettings ? { ...disabledServiceTier, reason: "invalid_json" } : disabledServiceTier
    }
  }

  if (!raw) {
    return {
      request: input.request,
      changed: false,
      replay: input.stripReasoningReplayEnabled ? { ...disabledReplay, reason: "empty_body" } : disabledReplay,
      developerRoleRemap: input.remapDeveloperMessagesToUserEnabled
        ? { ...disabledRoleRemap, reason: "empty_body" }
        : disabledRoleRemap,
      promptCacheKey: input.promptCacheKeyOverrideEnabled
        ? { ...disabledPromptCacheKey, reason: "empty_body" }
        : disabledPromptCacheKey,
      compatSanitizer: input.compatInputSanitizerEnabled
        ? { ...disabledCompatSanitizer, reason: "empty_body" }
        : disabledCompatSanitizer,
      serviceTier: input.behaviorSettings ? { ...disabledServiceTier, reason: "empty_body" } : disabledServiceTier
    }
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return {
      request: input.request,
      changed: false,
      replay: input.stripReasoningReplayEnabled ? { ...disabledReplay, reason: "invalid_json" } : disabledReplay,
      developerRoleRemap: input.remapDeveloperMessagesToUserEnabled
        ? { ...disabledRoleRemap, reason: "invalid_json" }
        : disabledRoleRemap,
      promptCacheKey: input.promptCacheKeyOverrideEnabled
        ? { ...disabledPromptCacheKey, reason: "invalid_json" }
        : disabledPromptCacheKey,
      compatSanitizer: input.compatInputSanitizerEnabled
        ? { ...disabledCompatSanitizer, reason: "invalid_json" }
        : disabledCompatSanitizer,
      serviceTier: input.behaviorSettings ? { ...disabledServiceTier, reason: "invalid_json" } : disabledServiceTier
    }
  }

  if (!isRecord(payload)) {
    return {
      request: input.request,
      changed: false,
      replay: input.stripReasoningReplayEnabled ? { ...disabledReplay, reason: "non_object_body" } : disabledReplay,
      developerRoleRemap: input.remapDeveloperMessagesToUserEnabled
        ? { ...disabledRoleRemap, reason: "non_object_body" }
        : disabledRoleRemap,
      promptCacheKey: input.promptCacheKeyOverrideEnabled
        ? { ...disabledPromptCacheKey, reason: "non_object_body" }
        : disabledPromptCacheKey,
      compatSanitizer: input.compatInputSanitizerEnabled
        ? { ...disabledCompatSanitizer, reason: "non_object_body" }
        : disabledCompatSanitizer,
      serviceTier: input.behaviorSettings ? { ...disabledServiceTier, reason: "non_object_body" } : disabledServiceTier
    }
  }

  let changed = false
  const replay = input.stripReasoningReplayEnabled ? stripReasoningReplayFromPayload(payload) : disabledReplay
  changed = changed || replay.changed

  const developerRoleRemap = input.remapDeveloperMessagesToUserEnabled
    ? remapDeveloperMessagesToUserOnPayload(payload)
    : disabledRoleRemap
  changed = changed || developerRoleRemap.changed

  const promptCacheKey = input.promptCacheKeyOverrideEnabled
    ? applyPromptCacheKeyOverrideToPayload(payload, asString(input.promptCacheKeyOverride))
    : disabledPromptCacheKey
  changed = changed || promptCacheKey.changed

  const compatSanitizedPayload = input.compatInputSanitizerEnabled ? sanitizeRequestPayloadForCompat(payload) : null
  const compatSanitizer: CompatSanitizerTransformResult = input.compatInputSanitizerEnabled
    ? {
        changed: compatSanitizedPayload?.changed === true,
        reason: compatSanitizedPayload?.changed === true ? "updated" : "already_matches"
      }
    : disabledCompatSanitizer

  const finalPayload = compatSanitizedPayload?.payload ?? payload
  const catalogRuntimeDefaultsChanged = applyCatalogRuntimeDefaultsToPayload(
    finalPayload,
    input.catalogModels,
    input.behaviorSettings
  )
  const gpt54LongContextClampChanged =
    input.gpt54LongContextClampEnabled !== false ? applyGpt54LongContextClampsToPayload(finalPayload) : false
  const serviceTier = applyServiceTierOverrideToPayload(finalPayload, input.behaviorSettings)
  changed =
    changed ||
    compatSanitizer.changed ||
    catalogRuntimeDefaultsChanged ||
    gpt54LongContextClampChanged ||
    serviceTier.changed

  if (!changed) {
    return {
      request: input.request,
      changed: false,
      replay,
      developerRoleRemap,
      promptCacheKey,
      compatSanitizer,
      serviceTier: { ...serviceTier, request: input.request }
    }
  }

  return {
    request: rebuildRequestWithJsonBody(input.request, finalPayload),
    changed: true,
    replay,
    developerRoleRemap,
    promptCacheKey,
    compatSanitizer,
    serviceTier: {
      ...serviceTier,
      request: input.request
    }
  }
}

export async function applyServiceTierOverrideToRequest(input: {
  request: Request
  behaviorSettings?: BehaviorSettings
}): Promise<ServiceTierTransformResult> {
  if (!input.behaviorSettings) {
    return { request: input.request, changed: false, reason: "disabled" }
  }

  const transformed = await transformOutboundRequestPayload({
    request: input.request,
    stripReasoningReplayEnabled: false,
    remapDeveloperMessagesToUserEnabled: false,
    compatInputSanitizerEnabled: false,
    promptCacheKeyOverrideEnabled: false,
    gpt54LongContextClampEnabled: false,
    behaviorSettings: input.behaviorSettings
  })
  return {
    request: transformed.request,
    changed: transformed.serviceTier.changed,
    reason: transformed.serviceTier.reason,
    serviceTier: transformed.serviceTier.serviceTier
  }
}

export async function applyPromptCacheKeyOverrideToRequest(input: {
  request: Request
  enabled: boolean
  promptCacheKey?: string
}): Promise<{ request: Request; changed: boolean; reason: string }> {
  const transformed = await transformOutboundRequestPayload({
    request: input.request,
    stripReasoningReplayEnabled: false,
    remapDeveloperMessagesToUserEnabled: false,
    compatInputSanitizerEnabled: false,
    promptCacheKeyOverrideEnabled: input.enabled,
    gpt54LongContextClampEnabled: false,
    promptCacheKeyOverride: input.promptCacheKey
  })
  return {
    request: transformed.request,
    changed: transformed.promptCacheKey.changed,
    reason: transformed.promptCacheKey.reason
  }
}

export async function remapDeveloperMessagesToUserOnRequest(input: { request: Request; enabled: boolean }): Promise<{
  request: Request
  changed: boolean
  reason: string
  remappedCount: number
  preservedCount: number
}> {
  const transformed = await transformOutboundRequestPayload({
    request: input.request,
    stripReasoningReplayEnabled: false,
    remapDeveloperMessagesToUserEnabled: input.enabled,
    compatInputSanitizerEnabled: false,
    promptCacheKeyOverrideEnabled: false,
    gpt54LongContextClampEnabled: false
  })
  return {
    request: transformed.request,
    changed: transformed.developerRoleRemap.changed,
    reason: transformed.developerRoleRemap.reason,
    remappedCount: transformed.developerRoleRemap.remappedCount,
    preservedCount: transformed.developerRoleRemap.preservedCount
  }
}

export async function stripReasoningReplayFromRequest(input: { request: Request; enabled: boolean }): Promise<{
  request: Request
  changed: boolean
  reason: string
  removedPartCount: number
  removedFieldCount: number
}> {
  const transformed = await transformOutboundRequestPayload({
    request: input.request,
    stripReasoningReplayEnabled: input.enabled,
    remapDeveloperMessagesToUserEnabled: false,
    compatInputSanitizerEnabled: false,
    promptCacheKeyOverrideEnabled: false,
    gpt54LongContextClampEnabled: false
  })
  return {
    request: transformed.request,
    changed: transformed.replay.changed,
    reason: transformed.replay.reason,
    removedPartCount: transformed.replay.removedPartCount,
    removedFieldCount: transformed.replay.removedFieldCount
  }
}

function applyServiceTierOverrideToPayload(
  payload: Record<string, unknown>,
  behaviorSettings: BehaviorSettings | undefined
): Omit<ServiceTierTransformResult, "request"> {
  if (!behaviorSettings) {
    return { changed: false, reason: "disabled" }
  }

  const currentServiceTier = asString(payload.service_tier)
  if (currentServiceTier) {
    return {
      changed: false,
      reason: "preserved",
      serviceTier: currentServiceTier
    }
  }

  const modelSlug = asString(payload.model)
  if (!modelSlug) {
    return { changed: false, reason: "missing_model" }
  }

  const modelCandidates = getModelLookupCandidates({
    id: modelSlug,
    api: { id: modelSlug }
  })
  const variantCandidates = getRequestBodyVariantCandidates({
    body: payload,
    modelSlug
  })
  const resolvedServiceTier = resolveServiceTierForModel({
    behaviorSettings,
    modelCandidates,
    variantCandidates
  })

  if (!resolvedServiceTier || resolvedServiceTier === "default") {
    return { changed: false, reason: "not_configured" }
  }

  if (resolvedServiceTier === "priority" && !supportsPriorityServiceTierModel(modelCandidates)) {
    return { changed: false, reason: "unsupported_model" }
  }

  payload.service_tier = resolvedServiceTier
  return {
    changed: true,
    reason: "updated",
    serviceTier: resolvedServiceTier
  }
}

function supportsPriorityServiceTierModel(modelCandidates: string[]): boolean {
  return modelCandidates.some((candidate) => candidate.trim().toLowerCase().startsWith("gpt-5.4"))
}

function applyCatalogRuntimeDefaultsToPayload(
  payload: Record<string, unknown>,
  catalogModels: CodexModelInfo[] | undefined,
  behaviorSettings: BehaviorSettings | undefined
): boolean {
  if (!catalogModels || catalogModels.length === 0) return false

  const modelSlug = asString(payload.model)
  if (!modelSlug) return false

  const modelCandidates = getModelLookupCandidates({
    id: modelSlug,
    api: { id: modelSlug }
  })
  const catalogModel = findCatalogModelForCandidates(catalogModels, modelCandidates)
  if (!catalogModel) return false

  const variantCandidates = getRequestBodyVariantCandidates({
    body: payload,
    modelSlug
  })
  const runtimeDefaults = getRuntimeDefaultsForModel(catalogModel)
  if (!runtimeDefaults) return false

  const globalBehavior = behaviorSettings?.global
  const thinkingSummariesOverride =
    getModelThinkingSummariesOverride(behaviorSettings, modelCandidates, variantCandidates) ??
    globalBehavior?.thinkingSummaries
  const verbosityEnabledOverride =
    getModelVerbosityEnabledOverride(behaviorSettings, modelCandidates, variantCandidates) ??
    (typeof globalBehavior?.verbosityEnabled === "boolean" ? globalBehavior.verbosityEnabled : undefined)
  const verbosityOverride =
    getModelVerbosityOverride(behaviorSettings, modelCandidates, variantCandidates) ??
    normalizeVerbositySetting(globalBehavior?.verbosity)
  const before = JSON.stringify({
    instructions: payload.instructions,
    reasoningEffort: payload.reasoningEffort,
    reasoningSummary: payload.reasoningSummary,
    textVerbosity: payload.textVerbosity,
    applyPatchToolType: payload.applyPatchToolType,
    parallelToolCalls: payload.parallelToolCalls,
    include: payload.include
  })

  applyResolvedCodexRuntimeDefaults({
    options: payload,
    defaults: runtimeDefaults,
    modelToolCallCapable: undefined,
    thinkingSummariesOverride,
    verbosityEnabledOverride,
    verbosityOverride,
    preferCodexInstructions: false
  })

  const after = JSON.stringify({
    instructions: payload.instructions,
    reasoningEffort: payload.reasoningEffort,
    reasoningSummary: payload.reasoningSummary,
    textVerbosity: payload.textVerbosity,
    applyPatchToolType: payload.applyPatchToolType,
    parallelToolCalls: payload.parallelToolCalls,
    include: payload.include
  })
  return before !== after
}
