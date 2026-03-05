import type { BehaviorSettings } from "../config.js"
import { sanitizeRequestPayloadForCompat } from "../compat-sanitizer.js"
import { isRecord } from "../util.js"
import { getModelLookupCandidates } from "./request-transform-model.js"
import { getRequestBodyVariantCandidates, resolveServiceTierForModel } from "./request-transform-model-service-tier.js"
import { asString } from "./request-transform-shared.js"
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
  promptCacheKeyOverride?: string
}

export type OutboundRequestPayloadTransformResult = {
  request: Request
  changed: boolean
  replay: ReplayTransformResult
  developerRoleRemap: DeveloperRoleRemapTransformResult
  promptCacheKey: PromptCacheKeyTransformResult
  compatSanitizer: CompatSanitizerTransformResult
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
    promptCacheKeyOverrideEnabled: false
  })
  return {
    request: transformed.request,
    changed: transformed.compatSanitizer.changed
  }
}

export async function applyServiceTierOverrideToRequest(input: {
  request: Request
  behaviorSettings?: BehaviorSettings
}): Promise<ServiceTierTransformResult> {
  const method = input.request.method.toUpperCase()
  if (method !== "POST") {
    return { request: input.request, changed: false, reason: "non_post" }
  }

  let payload: unknown
  try {
    const raw = await input.request.clone().text()
    if (!raw) return { request: input.request, changed: false, reason: "empty_body" }
    payload = JSON.parse(raw)
  } catch {
    return { request: input.request, changed: false, reason: "invalid_json" }
  }

  if (!isRecord(payload)) {
    return { request: input.request, changed: false, reason: "non_object_body" }
  }

  const currentServiceTier = asString(payload.service_tier)
  if (currentServiceTier) {
    return {
      request: input.request,
      changed: false,
      reason: "preserved",
      serviceTier: currentServiceTier
    }
  }

  const modelSlug = asString(payload.model)
  if (!modelSlug) {
    return { request: input.request, changed: false, reason: "missing_model" }
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
    behaviorSettings: input.behaviorSettings,
    modelCandidates,
    variantCandidates
  })

  if (!resolvedServiceTier || resolvedServiceTier === "default") {
    return { request: input.request, changed: false, reason: "not_configured" }
  }

  const normalizedModelSlug = modelSlug.trim().toLowerCase()
  if (resolvedServiceTier === "priority" && !normalizedModelSlug.startsWith("gpt-5.4")) {
    return { request: input.request, changed: false, reason: "unsupported_model" }
  }

  payload.service_tier = resolvedServiceTier
  return {
    request: rebuildRequestWithJsonBody(input.request, payload),
    changed: true,
    reason: "updated",
    serviceTier: resolvedServiceTier
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
        : disabledCompatSanitizer
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
        : disabledCompatSanitizer
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
        : disabledCompatSanitizer
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
        : disabledCompatSanitizer
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
        : disabledCompatSanitizer
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
  changed = changed || compatSanitizer.changed

  if (!changed) {
    return {
      request: input.request,
      changed: false,
      replay,
      developerRoleRemap,
      promptCacheKey,
      compatSanitizer
    }
  }

  return {
    request: rebuildRequestWithJsonBody(input.request, finalPayload),
    changed: true,
    replay,
    developerRoleRemap,
    promptCacheKey,
    compatSanitizer
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
    promptCacheKeyOverrideEnabled: false
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
    promptCacheKeyOverrideEnabled: false
  })
  return {
    request: transformed.request,
    changed: transformed.replay.changed,
    reason: transformed.replay.reason,
    removedPartCount: transformed.replay.removedPartCount,
    removedFieldCount: transformed.replay.removedFieldCount
  }
}
