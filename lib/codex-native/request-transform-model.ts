import type { BehaviorSettings, PersonalityOption } from "../config.js"
import type { CodexModelInfo } from "../model-catalog.js"
import { isRecord } from "../util.js"
import {
  asString,
  asStringArray,
  EFFORT_SUFFIX_REGEX,
  mergeUnique,
  normalizeReasoningSummaryOption,
  normalizeTextVerbosity,
  normalizeVerbositySetting
} from "./request-transform-shared.js"

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

  if (typeof options.parallelToolCalls !== "boolean") {
    if (defaults.supportsParallelToolCalls !== undefined) {
      options.parallelToolCalls = defaults.supportsParallelToolCalls
    } else if (input.modelToolCallCapable !== undefined) {
      options.parallelToolCalls = input.modelToolCallCapable
    }
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
