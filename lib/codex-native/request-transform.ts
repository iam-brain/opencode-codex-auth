import type { BehaviorSettings, PersonalityOption } from "../config"
import type { CodexModelInfo } from "../model-catalog"
import { resolveInstructionsForModel } from "../model-catalog"
import { sanitizeRequestPayloadForCompat } from "../compat-sanitizer"
import { isRecord } from "../util"
import { isOrchestratorInstructions, replaceCodexToolCallsForOpenCode } from "./collaboration"

type ChatParamsOutput = {
  temperature: number
  topP: number
  topK: number
  options: Record<string, unknown>
}

type ModelRuntimeDefaults = {
  applyPatchToolType?: string
  defaultReasoningEffort?: string
  supportsReasoningSummaries?: boolean
  reasoningSummaryFormat?: string
  defaultVerbosity?: "low" | "medium" | "high"
  supportsVerbosity?: boolean
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function normalizeReasoningSummaryOption(value: unknown): "auto" | "concise" | "detailed" | undefined {
  const normalized = asString(value)?.toLowerCase()
  if (!normalized || normalized === "none") return undefined
  if (normalized === "auto" || normalized === "concise" || normalized === "detailed") return normalized
  return undefined
}

function normalizeTextVerbosity(value: unknown): "low" | "medium" | "high" | undefined {
  const normalized = asString(value)?.toLowerCase()
  if (!normalized) return undefined
  if (normalized === "low" || normalized === "medium" || normalized === "high") return normalized
  return undefined
}

function normalizeVerbositySetting(value: unknown): "default" | "low" | "medium" | "high" | undefined {
  const normalized = asString(value)?.toLowerCase()
  if (!normalized) return undefined
  if (normalized === "default" || normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized
  }
  return undefined
}

function readModelRuntimeDefaults(options: Record<string, unknown>): ModelRuntimeDefaults {
  const raw = options.codexRuntimeDefaults
  if (!isRecord(raw)) return {}
  return {
    applyPatchToolType: asString(raw.applyPatchToolType),
    defaultReasoningEffort: asString(raw.defaultReasoningEffort),
    supportsReasoningSummaries:
      typeof raw.supportsReasoningSummaries === "boolean" ? raw.supportsReasoningSummaries : undefined,
    reasoningSummaryFormat: asString(raw.reasoningSummaryFormat),
    defaultVerbosity:
      raw.defaultVerbosity === "low" || raw.defaultVerbosity === "medium" || raw.defaultVerbosity === "high"
        ? raw.defaultVerbosity
        : undefined,
    supportsVerbosity: typeof raw.supportsVerbosity === "boolean" ? raw.supportsVerbosity : undefined
  }
}

function mergeUnique(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function normalizePersonalityKey(value: unknown): string | undefined {
  const normalized = asString(value)?.toLowerCase()
  if (!normalized) return undefined
  if (normalized.includes("/") || normalized.includes("\\") || normalized.includes("..")) {
    return undefined
  }
  return normalized
}

export function getModelLookupCandidates(model: { id?: string; api?: { id?: string } }): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (value: string | undefined) => {
    const trimmed = value?.trim()
    if (!trimmed) return
    if (seen.has(trimmed)) return
    seen.add(trimmed)
    out.push(trimmed)
  }

  add(model.id)
  add(model.api?.id)
  add(model.id?.split("/").pop())
  add(model.api?.id?.split("/").pop())

  return out
}

export function getVariantLookupCandidates(input: { message?: unknown; modelCandidates: string[] }): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (value: string | undefined) => {
    const trimmed = value?.trim()
    if (!trimmed) return
    if (seen.has(trimmed)) return
    seen.add(trimmed)
    out.push(trimmed)
  }

  if (isRecord(input.message)) {
    add(asString(input.message.variant))
  }

  for (const candidate of input.modelCandidates) {
    const slash = candidate.lastIndexOf("/")
    if (slash <= 0 || slash >= candidate.length - 1) continue
    add(candidate.slice(slash + 1))
  }

  return out
}

const EFFORT_SUFFIX_REGEX = /-(none|minimal|low|medium|high|xhigh)$/i

function stripEffortSuffix(value: string): string {
  return value.replace(EFFORT_SUFFIX_REGEX, "")
}

export function findCatalogModelForCandidates(
  catalogModels: CodexModelInfo[] | undefined,
  modelCandidates: string[]
): CodexModelInfo | undefined {
  if (!catalogModels || catalogModels.length === 0) return undefined

  const wanted = new Set<string>()
  for (const candidate of modelCandidates) {
    const normalized = candidate.trim().toLowerCase()
    if (!normalized) continue
    wanted.add(normalized)
    wanted.add(stripEffortSuffix(normalized))
  }

  return catalogModels.find((model) => {
    const slug = model.slug.trim().toLowerCase()
    if (!slug) return false
    return wanted.has(slug) || wanted.has(stripEffortSuffix(slug))
  })
}

function resolveCaseInsensitiveEntry<T>(entries: Record<string, T> | undefined, candidate: string): T | undefined {
  if (!entries) return undefined

  const direct = entries[candidate]
  if (direct !== undefined) return direct

  const lowered = entries[candidate.toLowerCase()]
  if (lowered !== undefined) return lowered

  const loweredCandidate = candidate.toLowerCase()
  for (const [name, entry] of Object.entries(entries)) {
    if (name.trim().toLowerCase() === loweredCandidate) {
      return entry
    }
  }

  return undefined
}

function getModelPersonalityOverride(
  behaviorSettings: BehaviorSettings | undefined,
  modelCandidates: string[],
  variantCandidates: string[]
): string | undefined {
  const models = behaviorSettings?.perModel
  if (!models) return undefined

  for (const candidate of modelCandidates) {
    const entry = resolveCaseInsensitiveEntry(models, candidate)
    if (!entry) continue

    for (const variantCandidate of variantCandidates) {
      const variantEntry = resolveCaseInsensitiveEntry(entry.variants, variantCandidate)
      const variantPersonality = normalizePersonalityKey(variantEntry?.personality)
      if (variantPersonality) return variantPersonality
    }

    const modelPersonality = normalizePersonalityKey(entry.personality)
    if (modelPersonality) return modelPersonality
  }

  return undefined
}

export function getModelThinkingSummariesOverride(
  behaviorSettings: BehaviorSettings | undefined,
  modelCandidates: string[],
  variantCandidates: string[]
): boolean | undefined {
  const models = behaviorSettings?.perModel
  if (!models) return undefined

  for (const candidate of modelCandidates) {
    const entry = resolveCaseInsensitiveEntry(models, candidate)
    if (!entry) continue

    for (const variantCandidate of variantCandidates) {
      const variantEntry = resolveCaseInsensitiveEntry(entry.variants, variantCandidate)
      if (typeof variantEntry?.thinkingSummaries === "boolean") {
        return variantEntry.thinkingSummaries
      }
    }

    if (typeof entry.thinkingSummaries === "boolean") {
      return entry.thinkingSummaries
    }
  }

  return undefined
}

export function getModelVerbosityEnabledOverride(
  behaviorSettings: BehaviorSettings | undefined,
  modelCandidates: string[],
  variantCandidates: string[]
): boolean | undefined {
  const models = behaviorSettings?.perModel
  if (!models) return undefined

  for (const candidate of modelCandidates) {
    const entry = resolveCaseInsensitiveEntry(models, candidate)
    if (!entry) continue

    for (const variantCandidate of variantCandidates) {
      const variantEntry = resolveCaseInsensitiveEntry(entry.variants, variantCandidate)
      if (typeof variantEntry?.verbosityEnabled === "boolean") {
        return variantEntry.verbosityEnabled
      }
    }

    if (typeof entry.verbosityEnabled === "boolean") {
      return entry.verbosityEnabled
    }
  }

  return undefined
}

export function getModelVerbosityOverride(
  behaviorSettings: BehaviorSettings | undefined,
  modelCandidates: string[],
  variantCandidates: string[]
): "default" | "low" | "medium" | "high" | undefined {
  const models = behaviorSettings?.perModel
  if (!models) return undefined

  for (const candidate of modelCandidates) {
    const entry = resolveCaseInsensitiveEntry(models, candidate)
    if (!entry) continue

    for (const variantCandidate of variantCandidates) {
      const variantEntry = resolveCaseInsensitiveEntry(entry.variants, variantCandidate)
      const variantVerbosity = normalizeVerbositySetting(variantEntry?.verbosity)
      if (variantVerbosity) return variantVerbosity
    }

    const modelVerbosity = normalizeVerbositySetting(entry.verbosity)
    if (modelVerbosity) return modelVerbosity
  }

  return undefined
}

export function resolvePersonalityForModel(input: {
  behaviorSettings?: BehaviorSettings
  modelCandidates: string[]
  variantCandidates: string[]
  fallback?: PersonalityOption
}): string | undefined {
  const modelOverride = getModelPersonalityOverride(
    input.behaviorSettings,
    input.modelCandidates,
    input.variantCandidates
  )
  if (modelOverride) return modelOverride

  const globalOverride = normalizePersonalityKey(input.behaviorSettings?.global?.personality)
  if (globalOverride) return globalOverride

  return normalizePersonalityKey(input.fallback)
}

export function applyCodexRuntimeDefaultsToParams(input: {
  modelOptions: Record<string, unknown>
  modelToolCallCapable: boolean | undefined
  thinkingSummariesOverride: boolean | undefined
  verbosityEnabledOverride: boolean | undefined
  verbosityOverride: "default" | "low" | "medium" | "high" | undefined
  preferCodexInstructions: boolean
  output: ChatParamsOutput
}): void {
  const options = input.output.options
  const modelOptions = input.modelOptions
  const defaults = readModelRuntimeDefaults(modelOptions)
  const codexInstructions = asString(modelOptions.codexInstructions)

  if (codexInstructions && (input.preferCodexInstructions || asString(options.instructions) === undefined)) {
    options.instructions = codexInstructions
  }

  if (asString(options.reasoningEffort) === undefined && defaults.defaultReasoningEffort) {
    options.reasoningEffort = defaults.defaultReasoningEffort
  }

  const reasoningEffort = asString(options.reasoningEffort)
  const hasReasoning = reasoningEffort !== undefined && reasoningEffort !== "none"
  const rawReasoningSummary = asString(options.reasoningSummary)
  const hadExplicitReasoningSummary = rawReasoningSummary !== undefined
  const currentReasoningSummary = normalizeReasoningSummaryOption(rawReasoningSummary)
  if (rawReasoningSummary !== undefined) {
    if (currentReasoningSummary) {
      options.reasoningSummary = currentReasoningSummary
    } else {
      delete options.reasoningSummary
    }
  }
  if (!hadExplicitReasoningSummary && currentReasoningSummary === undefined) {
    if (hasReasoning && (defaults.supportsReasoningSummaries === true || input.thinkingSummariesOverride === true)) {
      if (input.thinkingSummariesOverride === false) {
        delete options.reasoningSummary
      } else {
        if (defaults.reasoningSummaryFormat?.toLowerCase() === "none") {
          delete options.reasoningSummary
        } else {
          options.reasoningSummary = defaults.reasoningSummaryFormat ?? "auto"
        }
      }
    }
  }

  const rawTextVerbosity = asString(options.textVerbosity)
  const explicitTextVerbosity = normalizeTextVerbosity(rawTextVerbosity)
  if (rawTextVerbosity !== undefined && !explicitTextVerbosity) {
    delete options.textVerbosity
  }

  const verbosityEnabled = input.verbosityEnabledOverride ?? true
  const verbositySetting = input.verbosityOverride ?? "default"
  const supportsVerbosity = defaults.supportsVerbosity !== false

  if (!supportsVerbosity || !verbosityEnabled) {
    delete options.textVerbosity
  } else if (normalizeTextVerbosity(options.textVerbosity) === undefined) {
    if (verbositySetting === "default") {
      if (defaults.defaultVerbosity) {
        options.textVerbosity = defaults.defaultVerbosity
      }
    } else {
      options.textVerbosity = verbositySetting
    }
  }

  if (asString(options.applyPatchToolType) === undefined && defaults.applyPatchToolType) {
    options.applyPatchToolType = defaults.applyPatchToolType
  }

  if (typeof options.parallelToolCalls !== "boolean" && input.modelToolCallCapable !== undefined) {
    options.parallelToolCalls = input.modelToolCallCapable
  }

  const shouldIncludeReasoning =
    hasReasoning &&
    ((asString(options.reasoningSummary) !== undefined &&
      asString(options.reasoningSummary)?.toLowerCase() !== "none") ||
      defaults.supportsReasoningSummaries === true)

  if (shouldIncludeReasoning) {
    const include = asStringArray(options.include) ?? []
    options.include = mergeUnique([...include, "reasoning.encrypted_content"])
  }
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

type TransformReason =
  | "disabled"
  | "non_post"
  | "empty_body"
  | "invalid_json"
  | "non_object_body"
  | "missing_input_array"
  | "no_reasoning_replay"
  | "no_developer_messages"
  | "permissions_only"
  | "missing_key"
  | "already_matches"
  | "set"
  | "replaced"
  | "updated"

type ReplayTransformResult = {
  changed: boolean
  reason: TransformReason
  removedPartCount: number
  removedFieldCount: number
}

type DeveloperRoleRemapTransformResult = {
  changed: boolean
  reason: TransformReason
  remappedCount: number
  preservedCount: number
}

type PromptCacheKeyTransformResult = {
  changed: boolean
  reason: TransformReason
}

type CompatSanitizerTransformResult = {
  changed: boolean
  reason: TransformReason
}

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

function stripReasoningReplayFromPayload(payload: Record<string, unknown>): ReplayTransformResult {
  if (!Array.isArray(payload.input)) {
    return {
      changed: false,
      reason: "missing_input_array",
      removedPartCount: 0,
      removedFieldCount: 0
    }
  }

  let changed = false
  let removedPartCount = 0
  let removedFieldCount = 0
  const nextInput: unknown[] = []

  for (const item of payload.input) {
    if (isReasoningReplayPart(item)) {
      changed = true
      removedPartCount += 1
      continue
    }

    if (!isRecord(item)) {
      nextInput.push(item)
      continue
    }

    const nextItem: Record<string, unknown> = { ...item }
    const role = asString(nextItem.role)?.toLowerCase()
    if (role === "assistant" && Array.isArray(nextItem.content)) {
      const contentOut: unknown[] = []
      for (const entry of nextItem.content) {
        if (isReasoningReplayPart(entry)) {
          changed = true
          removedPartCount += 1
          continue
        }
        const strippedEntry = stripReasoningReplayFields(entry)
        if (strippedEntry.removed > 0) {
          changed = true
          removedFieldCount += strippedEntry.removed
        }
        contentOut.push(strippedEntry.value)
      }
      nextItem.content = contentOut
    }

    const strippedItem = stripReasoningReplayFields(nextItem)
    if (strippedItem.removed > 0) {
      changed = true
      removedFieldCount += strippedItem.removed
    }
    nextInput.push(strippedItem.value)
  }

  if (!changed) {
    return {
      changed: false,
      reason: "no_reasoning_replay",
      removedPartCount,
      removedFieldCount
    }
  }

  payload.input = nextInput
  return {
    changed: true,
    reason: "updated",
    removedPartCount,
    removedFieldCount
  }
}

function remapDeveloperMessagesToUserOnPayload(payload: Record<string, unknown>): DeveloperRoleRemapTransformResult {
  if (!Array.isArray(payload.input)) {
    return {
      changed: false,
      reason: "missing_input_array",
      remappedCount: 0,
      preservedCount: 0
    }
  }

  let nextInput: unknown[] | undefined
  let remappedCount = 0
  let preservedCount = 0
  let developerCount = 0
  for (let index = 0; index < payload.input.length; index += 1) {
    const item = payload.input[index]
    if (!isRecord(item)) continue
    if (item.role !== "developer") continue
    developerCount += 1
    if (shouldPreserveDeveloperRole(item)) {
      preservedCount += 1
      continue
    }
    if (!nextInput) nextInput = payload.input.slice()
    nextInput[index] = {
      ...item,
      role: "user"
    }
    remappedCount += 1
  }

  if (!nextInput) {
    return {
      changed: false,
      reason: developerCount === 0 ? "no_developer_messages" : "permissions_only",
      remappedCount,
      preservedCount
    }
  }

  payload.input = nextInput
  return {
    changed: true,
    reason: "updated",
    remappedCount,
    preservedCount
  }
}

function applyPromptCacheKeyOverrideToPayload(
  payload: Record<string, unknown>,
  promptCacheKey: string | undefined
): PromptCacheKeyTransformResult {
  if (!promptCacheKey) {
    return { changed: false, reason: "missing_key" }
  }

  const current = asString(payload.prompt_cache_key)
  if (current === promptCacheKey) {
    return { changed: false, reason: "already_matches" }
  }

  payload.prompt_cache_key = promptCacheKey
  return {
    changed: true,
    reason: current ? "replaced" : "set"
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
      replay: input.stripReasoningReplayEnabled
        ? { ...disabledReplay, reason: "non_post" }
        : disabledReplay,
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
      replay: input.stripReasoningReplayEnabled
        ? { ...disabledReplay, reason: "invalid_json" }
        : disabledReplay,
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
      replay: input.stripReasoningReplayEnabled
        ? { ...disabledReplay, reason: "invalid_json" }
        : disabledReplay,
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
      replay: input.stripReasoningReplayEnabled
        ? { ...disabledReplay, reason: "non_object_body" }
        : disabledReplay,
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
  const replay = input.stripReasoningReplayEnabled
    ? stripReasoningReplayFromPayload(payload)
    : disabledReplay
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

function rebuildRequestWithJsonBody(request: Request, body: unknown): Request {
  const headers = new Headers(request.headers)
  headers.set("content-type", "application/json")

  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(body),
    redirect: request.redirect,
    signal: request.signal,
    credentials: request.credentials,
    cache: request.cache,
    mode: request.mode,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    integrity: request.integrity,
    keepalive: request.keepalive
  })
}

function messageContentToText(value: unknown): string {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return ""
  const parts: string[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    if (typeof entry.text === "string" && entry.text.trim().length > 0) {
      parts.push(entry.text)
    }
  }
  return parts.join("\n")
}

function shouldPreserveDeveloperRole(item: Record<string, unknown>): boolean {
  const text = messageContentToText(item.content).toLowerCase()
  if (!text) return false
  return (
    text.includes("<permissions instructions>") ||
    text.includes("filesystem sandboxing defines which files can be read or written")
  )
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

function stripReasoningReplayFields(value: unknown): { value: unknown; removed: number } {
  if (Array.isArray(value)) {
    let removed = 0
    const next = value.map((entry) => {
      const result = stripReasoningReplayFields(entry)
      removed += result.removed
      return result.value
    })
    return { value: next, removed }
  }

  if (!isRecord(value)) {
    return { value, removed: 0 }
  }

  let removed = 0
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key.toLowerCase() === "reasoning_content") {
      removed += 1
      continue
    }
    const result = stripReasoningReplayFields(entry)
    removed += result.removed
    out[key] = result.value
  }
  return { value: out, removed }
}

function isReasoningReplayPart(entry: unknown): boolean {
  if (!isRecord(entry)) return false
  const type = asString(entry.type)?.toLowerCase()
  if (!type) return false
  return type.startsWith("reasoning")
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

function getVariantCandidatesFromBody(input: { body: Record<string, unknown>; modelSlug: string }): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (value: string | undefined) => {
    const trimmed = value?.trim().toLowerCase()
    if (!trimmed) return
    if (seen.has(trimmed)) return
    seen.add(trimmed)
    out.push(trimmed)
  }

  const reasoning = isRecord(input.body.reasoning) ? input.body.reasoning : undefined
  add(asString(reasoning?.effort))

  const normalizedSlug = input.modelSlug.trim().toLowerCase()
  const suffix = normalizedSlug.match(EFFORT_SUFFIX_REGEX)?.[1]
  add(suffix)

  return out
}

const COLLABORATION_INSTRUCTION_MARKERS = ["# Plan Mode (Conversational)", "# Sub-agents", "# Tooling Compatibility ("]

function extractCollaborationInstructionTail(instructions: string): string | undefined {
  const normalized = instructions.trim()
  if (!normalized) return undefined

  let markerIndex: number | undefined
  for (const marker of COLLABORATION_INSTRUCTION_MARKERS) {
    const index = normalized.indexOf(marker)
    if (index < 0) continue
    if (markerIndex === undefined || index < markerIndex) markerIndex = index
  }

  if (markerIndex === undefined) return undefined
  const tail = normalized.slice(markerIndex).trim()
  return tail.length > 0 ? tail : undefined
}

export async function applyCatalogInstructionOverrideToRequest(input: {
  request: Request
  enabled: boolean
  catalogModels: CodexModelInfo[] | undefined
  behaviorSettings: BehaviorSettings | undefined
  fallbackPersonality: PersonalityOption | undefined
  preserveOrchestratorInstructions?: boolean
  replaceCodexToolCalls?: boolean
}): Promise<{ request: Request; changed: boolean; reason: string }> {
  if (!input.enabled) return { request: input.request, changed: false, reason: "disabled" }

  const method = input.request.method.toUpperCase()
  if (method !== "POST") return { request: input.request, changed: false, reason: "non_post" }

  let payload: unknown
  try {
    const raw = await input.request.clone().text()
    if (!raw) return { request: input.request, changed: false, reason: "empty_body" }
    payload = JSON.parse(raw)
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      // request body could not be parsed as JSON
    }
    return { request: input.request, changed: false, reason: "invalid_json" }
  }

  if (!isRecord(payload)) return { request: input.request, changed: false, reason: "non_object_body" }
  const modelSlugRaw = asString(payload.model)
  if (!modelSlugRaw) return { request: input.request, changed: false, reason: "missing_model" }

  const modelCandidates = getModelLookupCandidates({
    id: modelSlugRaw,
    api: { id: modelSlugRaw }
  })
  const variantCandidates = getVariantCandidatesFromBody({
    body: payload,
    modelSlug: modelSlugRaw
  })
  const effectivePersonality = resolvePersonalityForModel({
    behaviorSettings: input.behaviorSettings,
    modelCandidates,
    variantCandidates,
    fallback: input.fallbackPersonality
  })
  const catalogModel = findCatalogModelForCandidates(input.catalogModels, modelCandidates)
  if (!catalogModel) return { request: input.request, changed: false, reason: "catalog_model_not_found" }

  const rendered = resolveInstructionsForModel(catalogModel, effectivePersonality)
  if (!rendered) return { request: input.request, changed: false, reason: "rendered_empty_or_unsafe" }
  const renderedForRequest =
    input.replaceCodexToolCalls === true ? replaceCodexToolCallsForOpenCode(rendered) ?? rendered : rendered

  const currentInstructions = asString(payload.instructions)

  const preserveOrchestratorInstructions = input.preserveOrchestratorInstructions !== false
  if (preserveOrchestratorInstructions && isOrchestratorInstructions(currentInstructions)) {
    return { request: input.request, changed: false, reason: "orchestrator_instructions_preserved" }
  }

  if (currentInstructions === renderedForRequest) {
    return { request: input.request, changed: false, reason: "already_matches" }
  }

  if (currentInstructions && currentInstructions.includes(renderedForRequest)) {
    return { request: input.request, changed: false, reason: "already_contains_rendered" }
  }

  const collaborationTail = currentInstructions ? extractCollaborationInstructionTail(currentInstructions) : undefined
  const nextInstructionsBase = collaborationTail ? `${renderedForRequest}\n\n${collaborationTail}` : renderedForRequest
  const nextInstructions = nextInstructionsBase

  if (currentInstructions === nextInstructions) {
    return { request: input.request, changed: false, reason: "already_matches" }
  }

  payload.instructions = nextInstructions
  const updatedRequest = rebuildRequestWithJsonBody(input.request, payload)
  return { request: updatedRequest, changed: true, reason: "updated" }
}
