import type { BehaviorSettings, CustomModelConfig, PersonalityOption } from "../config.js"
import type { CodexModelInfo } from "../model-catalog.js"
import { getRuntimeDefaultsForModel, resolveInstructionsForModel } from "../model-catalog.js"
import { sanitizeRequestPayloadForCompat } from "../compat-sanitizer.js"
import { isRecord } from "../util.js"
import {
  findCatalogModelForCandidates,
  getConfiguredCustomModelReasoningSummaryOverride,
  getModelLookupCandidates,
  getModelReasoningSummaryOverride,
  resolvePersonalityForModel
} from "./request-transform-model.js"
import { type ReasoningSummaryValidationDiagnostic, resolveReasoningSummaryValue } from "./reasoning-summary.js"
import { getRequestBodyVariantCandidates } from "./request-transform-model-service-tier.js"
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

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

const GPT_5_4_MAX_CONTEXT_WINDOW = 1_050_000
const GPT_5_4_MAX_OUTPUT_TOKENS = 128_000
const GPT_5_4_MAX_PRACTICAL_INPUT_TOKENS = GPT_5_4_MAX_CONTEXT_WINDOW - GPT_5_4_MAX_OUTPUT_TOKENS

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function applyGpt54LongContextClampsToPayload(payload: Record<string, unknown>): boolean {
  const modelSlug = asString(payload.model)
  if (!modelSlug) return false

  const modelCandidates = getModelLookupCandidates({
    id: modelSlug,
    api: { id: modelSlug }
  })
  const isGpt54 = modelCandidates.some((candidate) => candidate.trim().toLowerCase().startsWith("gpt-5.4"))
  if (!isGpt54) return false

  let changed = false

  const contextWindow = asFiniteNumber(payload.model_context_window)
  if (contextWindow !== undefined && contextWindow > GPT_5_4_MAX_CONTEXT_WINDOW) {
    payload.model_context_window = GPT_5_4_MAX_CONTEXT_WINDOW
    changed = true
  }

  const effectiveContextWindowMax = Math.min(
    GPT_5_4_MAX_CONTEXT_WINDOW,
    asFiniteNumber(payload.model_context_window) ?? GPT_5_4_MAX_CONTEXT_WINDOW
  )
  const autoCompactMax = Math.max(
    0,
    Math.min(GPT_5_4_MAX_PRACTICAL_INPUT_TOKENS, effectiveContextWindowMax - GPT_5_4_MAX_OUTPUT_TOKENS)
  )
  const autoCompact = asFiniteNumber(payload.model_auto_compact_token_limit)
  if (autoCompact !== undefined && autoCompact > autoCompactMax) {
    payload.model_auto_compact_token_limit = autoCompactMax
    changed = true
  }

  const maxOutputTokens = asFiniteNumber(payload.max_output_tokens)
  if (maxOutputTokens !== undefined && maxOutputTokens > GPT_5_4_MAX_OUTPUT_TOKENS) {
    payload.max_output_tokens = GPT_5_4_MAX_OUTPUT_TOKENS
    changed = true
  }

  return changed
}

type OutboundRequestPayloadTransformInput = {
  request: Request
  selectedModelSlug?: string
  stripReasoningReplayEnabled: boolean
  remapDeveloperMessagesToUserEnabled: boolean
  compatInputSanitizerEnabled: boolean
  promptCacheKeyOverrideEnabled: boolean
  gpt54LongContextClampEnabled?: boolean
  promptCacheKeyOverride?: string
  catalogModels?: CodexModelInfo[]
  previousCatalogModels?: CodexModelInfo[]
  requestCatalogScopeChanged?: boolean
  fallbackPersonality?: PersonalityOption
  behaviorSettings?: BehaviorSettings
  customModels?: Record<string, CustomModelConfig>
}

export type OutboundRequestPayloadTransformResult = {
  request: Request
  changed: boolean
  replay: ReplayTransformResult
  developerRoleRemap: DeveloperRoleRemapTransformResult
  promptCacheKey: PromptCacheKeyTransformResult
  compatSanitizer: CompatSanitizerTransformResult
  serviceTier: ServiceTierTransformResult
  reasoningSummaryValidation?: ReasoningSummaryValidationDiagnostic
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
    reason: input.behaviorSettings ? "handled_by_chat_params" : "disabled"
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
      serviceTier: disabledServiceTier,
      reasoningSummaryValidation: undefined
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
      serviceTier: disabledServiceTier,
      reasoningSummaryValidation: undefined
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
      serviceTier: disabledServiceTier,
      reasoningSummaryValidation: undefined
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
      serviceTier: disabledServiceTier,
      reasoningSummaryValidation: undefined
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
      serviceTier: disabledServiceTier,
      reasoningSummaryValidation: undefined
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
  const selectedCatalogScopeSyncChanged = applySelectedCatalogScopeToPayload(finalPayload, {
    catalogModels: input.catalogModels,
    previousCatalogModels: input.previousCatalogModels,
    requestCatalogScopeChanged: input.requestCatalogScopeChanged === true,
    behaviorSettings: input.behaviorSettings,
    fallbackPersonality: input.fallbackPersonality
  })
  const gpt54LongContextClampChanged =
    input.gpt54LongContextClampEnabled !== false ? applyGpt54LongContextClampsToPayload(finalPayload) : false
  const serviceTier = disabledServiceTier
  const reasoningSummaryValidation = validateReasoningSummaryPayload({
    payload: finalPayload,
    selectedModelSlug: input.selectedModelSlug,
    catalogModels: input.catalogModels,
    behaviorSettings: input.behaviorSettings,
    customModels: input.customModels
  })
  changed =
    changed ||
    compatSanitizer.changed ||
    selectedCatalogScopeSyncChanged ||
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
      serviceTier: { ...serviceTier, request: input.request },
      reasoningSummaryValidation
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
    },
    reasoningSummaryValidation
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

export async function stripStaleCatalogScopedDefaultsFromRequest(input: {
  request: Request
  previousCatalogModels?: CodexModelInfo[]
  behaviorSettings?: BehaviorSettings
  fallbackPersonality?: PersonalityOption
}): Promise<{ request: Request; changed: boolean }> {
  let payload: unknown
  try {
    const raw = await input.request.clone().text()
    if (!raw) return { request: input.request, changed: false }
    payload = JSON.parse(raw)
  } catch {
    return { request: input.request, changed: false }
  }

  if (!isRecord(payload)) {
    return { request: input.request, changed: false }
  }

  const changed = applySelectedCatalogScopeToPayload(payload, {
    catalogModels: undefined,
    previousCatalogModels: input.previousCatalogModels,
    requestCatalogScopeChanged: true,
    behaviorSettings: input.behaviorSettings,
    fallbackPersonality: input.fallbackPersonality
  })

  return {
    request: changed ? rebuildRequestWithJsonBody(input.request, payload) : input.request,
    changed
  }
}

function resolveDefaultReasoningSummary(
  defaults: ReturnType<typeof getRuntimeDefaultsForModel> | undefined
): string | undefined {
  if (defaults?.supportsReasoningSummaries !== true) return undefined
  const format = defaults.reasoningSummaryFormat?.trim().toLowerCase()
  if (format === "none") return undefined
  return defaults.reasoningSummaryFormat ?? "auto"
}

function replaceCatalogInstructionPrefix(
  currentInstructions: string | undefined,
  previousInstructions: string | undefined,
  nextInstructions: string | undefined
): string | undefined {
  if (!currentInstructions || !previousInstructions || !nextInstructions) return undefined
  if (currentInstructions === previousInstructions) return nextInstructions

  const prefix = `${previousInstructions}\n\n`
  if (!currentInstructions.startsWith(prefix)) return undefined

  const tail = currentInstructions.slice(prefix.length).trim()
  return tail ? `${nextInstructions}\n\n${tail}` : nextInstructions
}

function stripCatalogInstructionPrefix(
  currentInstructions: string | undefined,
  previousInstructions: string | undefined
): string | undefined {
  if (!currentInstructions || !previousInstructions) return undefined
  if (currentInstructions === previousInstructions) return ""

  const prefix = `${previousInstructions}\n\n`
  if (!currentInstructions.startsWith(prefix)) return undefined

  return currentInstructions.slice(prefix.length).trim()
}

function shouldIncludeReasoningEncryptedContent(input: {
  reasoningEffort?: string
  reasoningSummary?: string
  defaults?: ReturnType<typeof getRuntimeDefaultsForModel>
}): boolean {
  const hasReasoning = input.reasoningEffort !== undefined && input.reasoningEffort !== "none"
  if (!hasReasoning) return false

  const summary = input.reasoningSummary?.trim().toLowerCase()
  if (summary && summary !== "none") return true
  return input.defaults?.supportsReasoningSummaries === true
}

function syncReasoningEncryptedContentInclude(input: {
  payload: Record<string, unknown>
  previousShouldInclude: boolean
  nextShouldInclude: boolean
  allowRemoval?: boolean
}): boolean {
  const include = asStringArray(input.payload.include)
  const hasEntry = include?.includes("reasoning.encrypted_content") === true

  if (input.previousShouldInclude && !input.nextShouldInclude && input.allowRemoval !== false && hasEntry && include) {
    const nextInclude = include.filter((entry) => entry !== "reasoning.encrypted_content")
    if (nextInclude.length > 0) {
      input.payload.include = nextInclude
    } else {
      delete input.payload.include
    }
    return true
  }

  if (!input.previousShouldInclude && input.nextShouldInclude) {
    input.payload.include = include
      ? Array.from(new Set([...include, "reasoning.encrypted_content"]))
      : ["reasoning.encrypted_content"]
    return true
  }

  return false
}

function validateReasoningSummaryPayload(input: {
  payload: Record<string, unknown>
  selectedModelSlug?: string
  catalogModels?: CodexModelInfo[]
  behaviorSettings?: BehaviorSettings
  customModels?: Record<string, CustomModelConfig>
}): ReasoningSummaryValidationDiagnostic | undefined {
  const modelSlug = asString(input.payload.model)
  const selectedModelSlug = asString(input.selectedModelSlug)
  if (!modelSlug && !selectedModelSlug) return undefined

  const modelCandidates = getModelLookupCandidates({
    id: modelSlug,
    api: { id: modelSlug }
  })
  const configuredModelCandidates = selectedModelSlug
    ? getModelLookupCandidates({
        id: selectedModelSlug,
        api: { id: modelSlug }
      })
    : modelCandidates
  const variantCandidates = getRequestBodyVariantCandidates({
    body: input.payload,
    modelSlug: modelSlug ?? selectedModelSlug ?? ""
  })
  const reasoning = isRecord(input.payload.reasoning) ? input.payload.reasoning : undefined
  const reasoningEffort = asString(reasoning?.effort)
  const reasoningSummary = asString(reasoning?.summary)
  const globalBehavior = input.behaviorSettings?.global
  const catalogModel = findCatalogModelForCandidates(input.catalogModels, modelCandidates)
  const defaults = catalogModel ? getRuntimeDefaultsForModel(catalogModel) : undefined
  const modelReasoningSummaryOverride = getModelReasoningSummaryOverride(
    input.behaviorSettings,
    configuredModelCandidates,
    variantCandidates
  )
  const customModelReasoningSummaryOverride = getConfiguredCustomModelReasoningSummaryOverride(
    input.customModels,
    configuredModelCandidates,
    variantCandidates
  )
  const globalReasoningSummary =
    typeof globalBehavior?.reasoningSummary === "string"
      ? globalBehavior.reasoningSummary
      : typeof globalBehavior?.reasoningSummaries === "boolean"
        ? globalBehavior.reasoningSummaries
          ? "auto"
          : "none"
        : undefined

  return resolveReasoningSummaryValue({
    explicitValue: reasoningSummary,
    explicitSource: "request.reasoning.summary",
    hasReasoning: reasoningEffort !== undefined && reasoningEffort !== "none",
    configuredValue: modelReasoningSummaryOverride ?? customModelReasoningSummaryOverride ?? globalReasoningSummary,
    configuredSource: "config.reasoningSummary",
    supportsReasoningSummaries: defaults?.supportsReasoningSummaries,
    defaultReasoningSummaryFormat: defaults?.reasoningSummaryFormat,
    defaultReasoningSummarySource: "codexRuntimeDefaults.reasoningSummaryFormat",
    model: modelSlug ?? selectedModelSlug
  }).diagnostic
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

function applySelectedCatalogScopeToPayload(
  payload: Record<string, unknown>,
  input: {
    catalogModels?: CodexModelInfo[]
    previousCatalogModels?: CodexModelInfo[]
    requestCatalogScopeChanged: boolean
    behaviorSettings?: BehaviorSettings
    fallbackPersonality?: PersonalityOption
  }
): boolean {
  if (!input.requestCatalogScopeChanged) return false

  const modelSlug = asString(payload.model)
  if (!modelSlug) return false

  const modelCandidates = getModelLookupCandidates({
    id: modelSlug,
    api: { id: modelSlug }
  })
  const previousCatalogModel = findCatalogModelForCandidates(input.previousCatalogModels, modelCandidates)
  if (!previousCatalogModel) return false
  const nextCatalogModel = findCatalogModelForCandidates(input.catalogModels, modelCandidates)

  const variantCandidates = getRequestBodyVariantCandidates({
    body: payload,
    modelSlug
  })
  const effectivePersonality = resolvePersonalityForModel({
    behaviorSettings: input.behaviorSettings,
    modelCandidates,
    variantCandidates,
    fallback: input.fallbackPersonality
  })
  const previousInstructions = resolveInstructionsForModel(previousCatalogModel, effectivePersonality)
  const previousRuntimeDefaults = getRuntimeDefaultsForModel(previousCatalogModel)
  if (!nextCatalogModel) {
    return clearPreviousCatalogScopedFields(payload, {
      previousInstructions,
      previousRuntimeDefaults
    })
  }

  const nextInstructions = resolveInstructionsForModel(nextCatalogModel, effectivePersonality)
  const nextRuntimeDefaults = getRuntimeDefaultsForModel(nextCatalogModel)

  let changed = false

  const currentInstructions = typeof payload.instructions === "string" ? payload.instructions : undefined
  const nextScopedInstructions = replaceCatalogInstructionPrefix(
    currentInstructions,
    previousInstructions,
    nextInstructions
  )
  if (nextScopedInstructions && nextScopedInstructions !== currentInstructions) {
    payload.instructions = nextScopedInstructions
    changed = true
  } else if (!nextInstructions) {
    const remainingInstructions = stripCatalogInstructionPrefix(currentInstructions, previousInstructions)
    if (remainingInstructions !== undefined) {
      if (remainingInstructions) {
        payload.instructions = remainingInstructions
      } else {
        delete payload.instructions
      }
      changed = true
    }
  }

  const reasoning = isRecord(payload.reasoning) ? payload.reasoning : undefined
  const reasoningEffortBefore = asString(reasoning?.effort)
  const reasoningSummaryBefore = asString(reasoning?.summary)
  let reasoningChanged = false
  if (
    reasoning &&
    reasoningEffortBefore &&
    previousRuntimeDefaults?.defaultReasoningEffort &&
    reasoningEffortBefore === previousRuntimeDefaults.defaultReasoningEffort &&
    nextRuntimeDefaults?.defaultReasoningEffort !== reasoningEffortBefore
  ) {
    if (nextRuntimeDefaults?.defaultReasoningEffort) {
      reasoning.effort = nextRuntimeDefaults.defaultReasoningEffort
    } else {
      delete reasoning.effort
    }
    changed = true
    reasoningChanged = true
  }

  const previousReasoningSummary = resolveDefaultReasoningSummary(previousRuntimeDefaults)
  const nextReasoningSummary = resolveDefaultReasoningSummary(nextRuntimeDefaults)
  if (reasoning) {
    if (
      reasoningSummaryBefore &&
      previousReasoningSummary &&
      reasoningSummaryBefore === previousReasoningSummary &&
      nextReasoningSummary !== reasoningSummaryBefore
    ) {
      if (nextReasoningSummary) {
        reasoning.summary = nextReasoningSummary
      } else {
        delete reasoning.summary
      }
      changed = true
      reasoningChanged = true
    } else if (
      reasoningSummaryBefore === undefined &&
      previousReasoningSummary === undefined &&
      nextReasoningSummary &&
      previousRuntimeDefaults?.defaultReasoningEffort &&
      reasoningEffortBefore === previousRuntimeDefaults.defaultReasoningEffort
    ) {
      reasoning.summary = nextReasoningSummary
      changed = true
      reasoningChanged = true
    }

    if (Object.keys(reasoning).length === 0) {
      delete payload.reasoning
    }
  }

  const text = isRecord(payload.text) ? payload.text : undefined
  const textVerbosity = asString(text?.verbosity)
  if (
    text &&
    textVerbosity &&
    previousRuntimeDefaults?.defaultVerbosity &&
    textVerbosity === previousRuntimeDefaults.defaultVerbosity &&
    nextRuntimeDefaults?.defaultVerbosity !== textVerbosity
  ) {
    if (nextRuntimeDefaults?.defaultVerbosity) {
      text.verbosity = nextRuntimeDefaults.defaultVerbosity
    } else {
      delete text.verbosity
    }
    if (Object.keys(text).length === 0) {
      delete payload.text
    }
    changed = true
  }

  if (
    typeof payload.parallel_tool_calls === "boolean" &&
    typeof previousRuntimeDefaults?.supportsParallelToolCalls === "boolean" &&
    payload.parallel_tool_calls === previousRuntimeDefaults.supportsParallelToolCalls &&
    nextRuntimeDefaults?.supportsParallelToolCalls !== payload.parallel_tool_calls
  ) {
    if (typeof nextRuntimeDefaults?.supportsParallelToolCalls === "boolean") {
      payload.parallel_tool_calls = nextRuntimeDefaults.supportsParallelToolCalls
    } else {
      delete payload.parallel_tool_calls
    }
    changed = true
  }

  const reasoningEffortAfter = asString(isRecord(payload.reasoning) ? payload.reasoning.effort : undefined)
  const reasoningSummaryAfter = asString(isRecord(payload.reasoning) ? payload.reasoning.summary : undefined)
  const previousShouldInclude = shouldIncludeReasoningEncryptedContent({
    reasoningEffort: reasoningEffortBefore,
    reasoningSummary: reasoningSummaryBefore,
    defaults: previousRuntimeDefaults
  })
  const nextShouldInclude = shouldIncludeReasoningEncryptedContent({
    reasoningEffort: reasoningEffortAfter,
    reasoningSummary: reasoningSummaryAfter,
    defaults: nextRuntimeDefaults
  })
  if (
    syncReasoningEncryptedContentInclude({
      payload,
      previousShouldInclude,
      nextShouldInclude,
      allowRemoval: reasoningChanged
    })
  ) {
    changed = true
  }

  return changed
}

function clearPreviousCatalogScopedFields(
  payload: Record<string, unknown>,
  input: {
    previousInstructions?: string
    previousRuntimeDefaults?: ReturnType<typeof getRuntimeDefaultsForModel>
  }
): boolean {
  let changed = false

  const remainingInstructions = stripCatalogInstructionPrefix(
    typeof payload.instructions === "string" ? payload.instructions : undefined,
    input.previousInstructions
  )
  if (remainingInstructions !== undefined) {
    if (remainingInstructions) {
      payload.instructions = remainingInstructions
    } else {
      delete payload.instructions
    }
    changed = true
  }

  const reasoning = isRecord(payload.reasoning) ? payload.reasoning : undefined
  const reasoningEffortBefore = asString(reasoning?.effort)
  const reasoningSummaryBefore = asString(reasoning?.summary)
  let reasoningChanged = false
  if (
    reasoning &&
    reasoningEffortBefore &&
    input.previousRuntimeDefaults?.defaultReasoningEffort &&
    reasoningEffortBefore === input.previousRuntimeDefaults.defaultReasoningEffort
  ) {
    delete reasoning.effort
    changed = true
    reasoningChanged = true
  }

  const previousReasoningSummary = resolveDefaultReasoningSummary(input.previousRuntimeDefaults)
  if (
    reasoning &&
    reasoningSummaryBefore &&
    previousReasoningSummary &&
    reasoningSummaryBefore === previousReasoningSummary
  ) {
    delete reasoning.summary
    changed = true
    reasoningChanged = true
  }

  if (reasoning && Object.keys(reasoning).length === 0) {
    delete payload.reasoning
  }

  const text = isRecord(payload.text) ? payload.text : undefined
  const textVerbosity = asString(text?.verbosity)
  if (
    text &&
    textVerbosity &&
    input.previousRuntimeDefaults?.defaultVerbosity &&
    textVerbosity === input.previousRuntimeDefaults.defaultVerbosity
  ) {
    delete text.verbosity
    if (Object.keys(text).length === 0) {
      delete payload.text
    }
    changed = true
  }

  if (
    typeof payload.parallel_tool_calls === "boolean" &&
    typeof input.previousRuntimeDefaults?.supportsParallelToolCalls === "boolean" &&
    payload.parallel_tool_calls === input.previousRuntimeDefaults.supportsParallelToolCalls
  ) {
    delete payload.parallel_tool_calls
    changed = true
  }

  const reasoningEffortAfter = asString(isRecord(payload.reasoning) ? payload.reasoning.effort : undefined)
  const reasoningSummaryAfter = asString(isRecord(payload.reasoning) ? payload.reasoning.summary : undefined)
  const previousShouldInclude = shouldIncludeReasoningEncryptedContent({
    reasoningEffort: reasoningEffortBefore,
    reasoningSummary: reasoningSummaryBefore,
    defaults: input.previousRuntimeDefaults
  })
  const nextShouldInclude = shouldIncludeReasoningEncryptedContent({
    reasoningEffort: reasoningEffortAfter,
    reasoningSummary: reasoningSummaryAfter
  })
  if (
    syncReasoningEncryptedContentInclude({
      payload,
      previousShouldInclude,
      nextShouldInclude,
      allowRemoval: reasoningChanged
    })
  ) {
    changed = true
  }

  return changed
}
