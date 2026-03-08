import type { BehaviorSettings, CustomModelConfig, ModelBehaviorOverride, PersonalityOption } from "../config.js"
import type { CodexModelInfo, CustomModelBehaviorConfig } from "../model-catalog.js"
import { isRecord } from "../util.js"
import { resolveReasoningSummaryValue } from "./reasoning-summary.js"

const EFFORT_SUFFIX_REGEX = /-(none|minimal|low|medium|high|xhigh)$/i

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function normalizeCustomIncludeOptions(value: unknown): CustomModelBehaviorConfig["include"] | undefined {
  const include = asStringArray(value)
  return include as CustomModelBehaviorConfig["include"] | undefined
}

function normalizeTextVerbosity(value: unknown): "low" | "medium" | "high" | undefined {
  const normalized = asString(value)?.toLowerCase()
  if (!normalized) return undefined
  if (normalized === "low" || normalized === "medium" || normalized === "high") return normalized
  return undefined
}

function normalizeVerbositySetting(value: unknown): "default" | "low" | "medium" | "high" | "none" | undefined {
  const normalized = asString(value)?.toLowerCase()
  if (!normalized) return undefined
  if (
    normalized === "default" ||
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "none"
  ) {
    return normalized
  }
  return undefined
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
  supportsParallelToolCalls?: boolean
  defaultVerbosity?: "low" | "medium" | "high"
  supportsVerbosity?: boolean
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
    supportsParallelToolCalls:
      typeof raw.supportsParallelToolCalls === "boolean" ? raw.supportsParallelToolCalls : undefined,
    defaultVerbosity:
      raw.defaultVerbosity === "low" || raw.defaultVerbosity === "medium" || raw.defaultVerbosity === "high"
        ? raw.defaultVerbosity
        : undefined,
    supportsVerbosity: typeof raw.supportsVerbosity === "boolean" ? raw.supportsVerbosity : undefined
  }
}

function normalizePersonalityKey(value: unknown): string | undefined {
  const normalized = asString(value)?.toLowerCase()
  if (!normalized) return undefined
  if (normalized.includes("/") || normalized.includes("\\") || normalized.includes("..")) {
    return undefined
  }
  return normalized
}

function readCustomModelConfig(options: Record<string, unknown>): CustomModelBehaviorConfig | undefined {
  const raw = options.codexCustomModelConfig
  if (!isRecord(raw)) return undefined
  const targetModel = asString(raw.targetModel)
  if (!targetModel) return undefined
  const variants = isRecord(raw.variants) ? (raw.variants as Record<string, ModelBehaviorOverride>) : undefined

  return {
    targetModel,
    ...(asString(raw.name) ? { name: asString(raw.name) } : {}),
    ...(normalizePersonalityKey(raw.personality) ? { personality: normalizePersonalityKey(raw.personality) } : {}),
    ...(asString(raw.reasoningEffort) ? { reasoningEffort: asString(raw.reasoningEffort) } : {}),
    ...(normalizeVerbositySetting(raw.textVerbosity)
      ? { textVerbosity: normalizeVerbositySetting(raw.textVerbosity) }
      : {}),
    ...(typeof raw.serviceTier === "string" &&
    (raw.serviceTier === "auto" || raw.serviceTier === "priority" || raw.serviceTier === "flex")
      ? { serviceTier: raw.serviceTier }
      : {}),
    ...(Array.isArray(raw.include) ? { include: normalizeCustomIncludeOptions(raw.include) } : {}),
    ...(typeof raw.parallelToolCalls === "boolean" ? { parallelToolCalls: raw.parallelToolCalls } : {}),
    ...(typeof raw.reasoningSummary === "string" &&
    (raw.reasoningSummary === "auto" ||
      raw.reasoningSummary === "concise" ||
      raw.reasoningSummary === "detailed" ||
      raw.reasoningSummary === "none")
      ? { reasoningSummary: raw.reasoningSummary }
      : {}),
    ...(variants ? { variants } : {})
  }
}

function getCustomModelBehaviorOverrideValue<T>(
  options: Record<string, unknown>,
  variantCandidates: string[],
  selector: (entry: ModelBehaviorOverride) => T | undefined
): T | undefined {
  const config = readCustomModelConfig(options)
  if (!config) return undefined

  for (const variantCandidate of variantCandidates) {
    const variantEntry = resolveCaseInsensitiveEntry(config.variants, variantCandidate)
    if (!variantEntry) continue
    const variantValue = selector(variantEntry)
    if (variantValue !== undefined) return variantValue
  }

  return selector(config)
}

export function getConfiguredCustomModelBehaviorOverrideValue<T>(
  customModels: Record<string, CustomModelConfig> | undefined,
  modelCandidates: string[],
  variantCandidates: string[],
  selector: (entry: ModelBehaviorOverride) => T | undefined
): T | undefined {
  if (!customModels) return undefined

  for (const candidate of getModelLookupCandidatesWithEffortFallback(modelCandidates)) {
    const entry = resolveCaseInsensitiveEntry(customModels, candidate)
    if (!entry) continue

    for (const variantCandidate of variantCandidates) {
      const variantEntry = resolveCaseInsensitiveEntry(entry.variants, variantCandidate)
      if (!variantEntry) continue
      const variantValue = selector(variantEntry)
      if (variantValue !== undefined) return variantValue
    }

    const modelValue = selector(entry)
    if (modelValue !== undefined) return modelValue
  }

  return undefined
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

export function getSelectedModelLookupCandidates(model: { id?: string }): string[] {
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
  add(model.id?.split("/").pop())

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

function getModelLookupCandidatesWithEffortFallback(modelCandidates: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (value: string | undefined) => {
    const trimmed = value?.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    out.push(trimmed)
  }

  for (const candidate of modelCandidates) {
    add(candidate)
    add(stripEffortSuffix(candidate))
  }

  return out
}

function getModelBehaviorOverrideValue<T>(
  behaviorSettings: BehaviorSettings | undefined,
  modelCandidates: string[],
  variantCandidates: string[],
  selector: (entry: ModelBehaviorOverride) => T | undefined
): T | undefined {
  const models = behaviorSettings?.perModel
  if (!models) return undefined

  for (const candidate of getModelLookupCandidatesWithEffortFallback(modelCandidates)) {
    const entry = resolveCaseInsensitiveEntry(models, candidate)
    if (!entry) continue

    for (const variantCandidate of variantCandidates) {
      const variantEntry = resolveCaseInsensitiveEntry(entry.variants, variantCandidate)
      if (!variantEntry) continue
      const variantValue = selector(variantEntry)
      if (variantValue !== undefined) return variantValue
    }

    const modelValue = selector(entry)
    if (modelValue !== undefined) return modelValue
  }

  return undefined
}

function getModelPersonalityOverride(
  behaviorSettings: BehaviorSettings | undefined,
  modelCandidates: string[],
  variantCandidates: string[]
): string | undefined {
  return getModelBehaviorOverrideValue(behaviorSettings, modelCandidates, variantCandidates, (entry) =>
    normalizePersonalityKey(entry.personality)
  )
}

export function getModelReasoningEffortOverride(
  behaviorSettings: BehaviorSettings | undefined,
  modelCandidates: string[],
  variantCandidates: string[]
): string | undefined {
  return getModelBehaviorOverrideValue(behaviorSettings, modelCandidates, variantCandidates, (entry) =>
    asString(entry.reasoningEffort)
  )
}

export function getModelReasoningSummaryOverride(
  behaviorSettings: BehaviorSettings | undefined,
  modelCandidates: string[],
  variantCandidates: string[]
): "auto" | "concise" | "detailed" | "none" | undefined {
  return getModelBehaviorOverrideValue(behaviorSettings, modelCandidates, variantCandidates, (entry) => {
    const normalized = asString(entry.reasoningSummary)?.toLowerCase()
    if (normalized === "auto" || normalized === "concise" || normalized === "detailed" || normalized === "none") {
      return normalized
    }
    if (typeof entry.reasoningSummaries === "boolean") {
      return entry.reasoningSummaries ? "auto" : "none"
    }
    return undefined
  })
}

export function getModelReasoningSummariesOverride(
  behaviorSettings: BehaviorSettings | undefined,
  modelCandidates: string[],
  variantCandidates: string[]
): boolean | undefined {
  const summary = getModelReasoningSummaryOverride(behaviorSettings, modelCandidates, variantCandidates)
  return summary === undefined ? undefined : summary !== "none"
}

export function getModelTextVerbosityOverride(
  behaviorSettings: BehaviorSettings | undefined,
  modelCandidates: string[],
  variantCandidates: string[]
): "default" | "low" | "medium" | "high" | "none" | undefined {
  return getModelBehaviorOverrideValue(behaviorSettings, modelCandidates, variantCandidates, (entry) => {
    const textVerbosity = normalizeVerbositySetting(entry.textVerbosity)
    if (textVerbosity) return textVerbosity
    if (typeof entry.verbosityEnabled === "boolean" && entry.verbosityEnabled === false) return "none"
    return normalizeVerbositySetting(entry.verbosity)
  })
}

export function getModelVerbosityEnabledOverride(
  behaviorSettings: BehaviorSettings | undefined,
  modelCandidates: string[],
  variantCandidates: string[]
): boolean | undefined {
  const textVerbosity = getModelTextVerbosityOverride(behaviorSettings, modelCandidates, variantCandidates)
  return textVerbosity === undefined ? undefined : textVerbosity !== "none"
}

export function getModelVerbosityOverride(
  behaviorSettings: BehaviorSettings | undefined,
  modelCandidates: string[],
  variantCandidates: string[]
): "default" | "low" | "medium" | "high" | undefined {
  const textVerbosity = getModelTextVerbosityOverride(behaviorSettings, modelCandidates, variantCandidates)
  if (!textVerbosity || textVerbosity === "none") return undefined
  return textVerbosity
}

export function getModelIncludeOverride(
  behaviorSettings: BehaviorSettings | undefined,
  modelCandidates: string[],
  variantCandidates: string[]
): string[] | undefined {
  return getModelBehaviorOverrideValue(behaviorSettings, modelCandidates, variantCandidates, (entry) => {
    const include = asStringArray(entry.include)
    return include && include.length > 0 ? include : undefined
  })
}

export function getModelParallelToolCallsOverride(
  behaviorSettings: BehaviorSettings | undefined,
  modelCandidates: string[],
  variantCandidates: string[]
): boolean | undefined {
  return getModelBehaviorOverrideValue(behaviorSettings, modelCandidates, variantCandidates, (entry) =>
    typeof entry.parallelToolCalls === "boolean" ? entry.parallelToolCalls : undefined
  )
}

export function getCustomModelReasoningEffortOverride(
  options: Record<string, unknown>,
  variantCandidates: string[]
): string | undefined {
  return getCustomModelBehaviorOverrideValue(options, variantCandidates, (entry) => asString(entry.reasoningEffort))
}

export function getCustomModelReasoningSummaryOverride(
  options: Record<string, unknown>,
  variantCandidates: string[]
): "auto" | "concise" | "detailed" | "none" | undefined {
  return getCustomModelBehaviorOverrideValue(options, variantCandidates, (entry) => {
    const normalized = asString(entry.reasoningSummary)?.toLowerCase()
    if (normalized === "auto" || normalized === "concise" || normalized === "detailed" || normalized === "none") {
      return normalized
    }
    return undefined
  })
}

export function getConfiguredCustomModelReasoningSummaryOverride(
  customModels: Record<string, CustomModelConfig> | undefined,
  modelCandidates: string[],
  variantCandidates: string[]
): "auto" | "concise" | "detailed" | "none" | undefined {
  return getConfiguredCustomModelBehaviorOverrideValue(customModels, modelCandidates, variantCandidates, (entry) => {
    const normalized = asString(entry.reasoningSummary)?.toLowerCase()
    if (normalized === "auto" || normalized === "concise" || normalized === "detailed" || normalized === "none") {
      return normalized
    }
    if (typeof entry.reasoningSummaries === "boolean") {
      return entry.reasoningSummaries ? "auto" : "none"
    }
    return undefined
  })
}

export function getCustomModelTextVerbosityOverride(
  options: Record<string, unknown>,
  variantCandidates: string[]
): "default" | "low" | "medium" | "high" | "none" | undefined {
  return getCustomModelBehaviorOverrideValue(options, variantCandidates, (entry) => {
    const textVerbosity = normalizeVerbositySetting(entry.textVerbosity)
    if (textVerbosity) return textVerbosity
    if (typeof entry.verbosityEnabled === "boolean" && entry.verbosityEnabled === false) return "none"
    return normalizeVerbositySetting(entry.verbosity)
  })
}

export function getCustomModelIncludeOverride(
  options: Record<string, unknown>,
  variantCandidates: string[]
): string[] | undefined {
  return getCustomModelBehaviorOverrideValue(options, variantCandidates, (entry) => {
    const include = asStringArray(entry.include)
    return include && include.length > 0 ? include : undefined
  })
}

export function getCustomModelParallelToolCallsOverride(
  options: Record<string, unknown>,
  variantCandidates: string[]
): boolean | undefined {
  return getCustomModelBehaviorOverrideValue(options, variantCandidates, (entry) =>
    typeof entry.parallelToolCalls === "boolean" ? entry.parallelToolCalls : undefined
  )
}

export function getCustomModelPersonalityOverride(
  options: Record<string, unknown>,
  variantCandidates: string[]
): string | undefined {
  return getCustomModelBehaviorOverrideValue(options, variantCandidates, (entry) =>
    normalizePersonalityKey(entry.personality)
  )
}

export function resolvePersonalityForModel(input: {
  behaviorSettings?: BehaviorSettings
  modelOptions?: Record<string, unknown>
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

  const customModelOverride = input.modelOptions
    ? getCustomModelPersonalityOverride(input.modelOptions, input.variantCandidates)
    : undefined
  if (customModelOverride) return customModelOverride

  const globalOverride = normalizePersonalityKey(input.behaviorSettings?.global?.personality)
  if (globalOverride) return globalOverride

  return normalizePersonalityKey(input.fallback)
}

export function applyResolvedCodexRuntimeDefaults(input: {
  options: Record<string, unknown>
  codexInstructions?: string
  defaults?: {
    applyPatchToolType?: string
    defaultReasoningEffort?: string
    supportsReasoningSummaries?: boolean
    reasoningSummaryFormat?: string
    supportsParallelToolCalls?: boolean
    defaultVerbosity?: "low" | "medium" | "high"
    supportsVerbosity?: boolean
  }
  modelToolCallCapable: boolean | undefined
  resolvedBehavior: {
    reasoningEffort?: string
    reasoningSummary?: "auto" | "concise" | "detailed" | "none"
    textVerbosity?: "default" | "low" | "medium" | "high" | "none"
    include?: string[]
    parallelToolCalls?: boolean
  }
  modelId?: string
  preferCodexInstructions: boolean
}): {
  injectedFields: Array<"instructions" | "reasoningEffort" | "reasoningSummary" | "textVerbosity" | "parallelToolCalls">
} {
  const options = input.options
  const defaults = input.defaults ?? {}
  const codexInstructions = asString(input.codexInstructions)
  const injectedFields = new Set<
    "instructions" | "reasoningEffort" | "reasoningSummary" | "textVerbosity" | "parallelToolCalls"
  >()

  if (codexInstructions && (input.preferCodexInstructions || asString(options.instructions) === undefined)) {
    options.instructions = codexInstructions
    injectedFields.add("instructions")
  }

  if (asString(options.reasoningEffort) === undefined) {
    if (input.resolvedBehavior.reasoningEffort) {
      options.reasoningEffort = input.resolvedBehavior.reasoningEffort
      injectedFields.add("reasoningEffort")
    } else if (defaults.defaultReasoningEffort) {
      options.reasoningEffort = defaults.defaultReasoningEffort
      injectedFields.add("reasoningEffort")
    }
  }

  const reasoningEffort = asString(options.reasoningEffort)
  const hasReasoning = reasoningEffort !== undefined && reasoningEffort !== "none"
  const rawReasoningSummary = asString(options.reasoningSummary)
  const reasoningSummary = resolveReasoningSummaryValue({
    explicitValue: rawReasoningSummary,
    explicitSource: "options.reasoningSummary",
    hasReasoning,
    configuredValue: input.resolvedBehavior.reasoningSummary,
    configuredSource: "config.reasoningSummary",
    supportsReasoningSummaries: defaults.supportsReasoningSummaries,
    defaultReasoningSummaryFormat: defaults.reasoningSummaryFormat,
    defaultReasoningSummarySource: "codexRuntimeDefaults.reasoningSummaryFormat",
    model: input.modelId
  })
  if (reasoningSummary.value) {
    options.reasoningSummary = reasoningSummary.value
    if (rawReasoningSummary === undefined) {
      injectedFields.add("reasoningSummary")
    }
  } else if (
    rawReasoningSummary?.trim().toLowerCase() === "none" ||
    input.resolvedBehavior.reasoningSummary === "none"
  ) {
    delete options.reasoningSummary
  }

  const rawTextVerbosity = asString(options.textVerbosity)
  const explicitTextVerbosity = normalizeTextVerbosity(rawTextVerbosity)
  if (rawTextVerbosity !== undefined && !explicitTextVerbosity) {
    delete options.textVerbosity
  }

  const supportsVerbosity = defaults.supportsVerbosity !== false
  const verbositySetting = input.resolvedBehavior.textVerbosity ?? "default"

  if (!supportsVerbosity || verbositySetting === "none") {
    delete options.textVerbosity
  } else if (normalizeTextVerbosity(options.textVerbosity) === undefined) {
    if (verbositySetting === "default") {
      if (defaults.defaultVerbosity) {
        options.textVerbosity = defaults.defaultVerbosity
        injectedFields.add("textVerbosity")
      }
    } else {
      options.textVerbosity = verbositySetting
      injectedFields.add("textVerbosity")
    }
  }

  if (asString(options.applyPatchToolType) === undefined && defaults.applyPatchToolType) {
    options.applyPatchToolType = defaults.applyPatchToolType
  }

  if (typeof options.parallelToolCalls !== "boolean") {
    if (input.resolvedBehavior.parallelToolCalls !== undefined) {
      options.parallelToolCalls = input.resolvedBehavior.parallelToolCalls
      injectedFields.add("parallelToolCalls")
    } else if (defaults.supportsParallelToolCalls !== undefined) {
      options.parallelToolCalls = defaults.supportsParallelToolCalls
      injectedFields.add("parallelToolCalls")
    } else if (input.modelToolCallCapable !== undefined) {
      options.parallelToolCalls = input.modelToolCallCapable
      injectedFields.add("parallelToolCalls")
    }
  }

  const configuredInclude = input.resolvedBehavior.include ?? []
  if (configuredInclude.length > 0) {
    const include = asStringArray(options.include) ?? []
    options.include = mergeUnique([...include, ...configuredInclude])
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

  return {
    injectedFields: Array.from(injectedFields)
  }
}

export function applyCodexRuntimeDefaultsToParams(input: {
  modelOptions: Record<string, unknown>
  modelToolCallCapable: boolean | undefined
  resolvedBehavior: {
    reasoningEffort?: string
    reasoningSummary?: "auto" | "concise" | "detailed" | "none"
    textVerbosity?: "default" | "low" | "medium" | "high" | "none"
    include?: string[]
    parallelToolCalls?: boolean
  }
  preferCodexInstructions: boolean
  modelId?: string
  output: ChatParamsOutput
}): {
  injectedFields: Array<"instructions" | "reasoningEffort" | "reasoningSummary" | "textVerbosity" | "parallelToolCalls">
} {
  const modelOptions = input.modelOptions
  return applyResolvedCodexRuntimeDefaults({
    options: input.output.options,
    codexInstructions: asString(modelOptions.codexInstructions),
    defaults: readModelRuntimeDefaults(modelOptions),
    modelToolCallCapable: input.modelToolCallCapable,
    resolvedBehavior: input.resolvedBehavior,
    modelId: input.modelId,
    preferCodexInstructions: input.preferCodexInstructions
  })
}
