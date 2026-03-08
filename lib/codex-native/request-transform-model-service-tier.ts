import type { BehaviorSettings, ModelBehaviorOverride, ServiceTierOption } from "../config.js"
import type { CustomModelBehaviorConfig } from "../model-catalog.js"
import { isRecord } from "../util.js"

const EFFORT_SUFFIX_REGEX = /-(none|minimal|low|medium|high|xhigh)$/i

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
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

function normalizeServiceTierSetting(value: unknown): ServiceTierOption | undefined {
  const normalized = asString(value)?.toLowerCase()
  if (normalized === "default" || normalized === "auto") {
    return "auto"
  }
  if (normalized === "priority" || normalized === "flex") {
    return normalized
  }
  return undefined
}

function stripEffortSuffix(value: string): string {
  return value.replace(EFFORT_SUFFIX_REGEX, "")
}

function readCustomModelConfig(options: Record<string, unknown>): CustomModelBehaviorConfig | undefined {
  const raw = options.codexCustomModelConfig
  if (!isRecord(raw)) return undefined
  const targetModel = asString(raw.targetModel)
  if (!targetModel) return undefined
  return {
    targetModel,
    ...(asString(raw.name) ? { name: asString(raw.name) } : {}),
    ...(typeof raw.serviceTier === "string" ? { serviceTier: raw.serviceTier as ServiceTierOption } : {}),
    ...(isRecord(raw.variants) ? { variants: raw.variants as Record<string, ModelBehaviorOverride> } : {})
  }
}

export function getCustomModelServiceTierOverride(
  modelOptions: Record<string, unknown>,
  variantCandidates: string[]
): ServiceTierOption | undefined {
  const customModel = readCustomModelConfig(modelOptions)
  if (!customModel) return undefined

  for (const variantCandidate of variantCandidates) {
    const variantEntry = resolveCaseInsensitiveEntry(customModel.variants, variantCandidate)
    const variantServiceTier = normalizeServiceTierSetting(variantEntry?.serviceTier)
    if (variantServiceTier) return variantServiceTier
  }

  return normalizeServiceTierSetting(customModel.serviceTier)
}

export function getRequestBodyVariantCandidates(input: { body: Record<string, unknown>; modelSlug: string }): string[] {
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

export function getModelServiceTierOverride(
  behaviorSettings: BehaviorSettings | undefined,
  modelCandidates: string[],
  variantCandidates: string[]
): ServiceTierOption | undefined {
  const models = behaviorSettings?.perModel
  if (!models) return undefined

  const lookupCandidates: string[] = []
  const seen = new Set<string>()
  const addCandidate = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    lookupCandidates.push(trimmed)
  }

  for (const candidate of modelCandidates) {
    addCandidate(candidate)
    addCandidate(stripEffortSuffix(candidate))
  }

  for (const candidate of lookupCandidates) {
    const entry = resolveCaseInsensitiveEntry(models, candidate)
    if (!entry) continue

    for (const variantCandidate of variantCandidates) {
      const variantEntry = resolveCaseInsensitiveEntry(entry.variants, variantCandidate)
      const variantServiceTier = normalizeServiceTierSetting(variantEntry?.serviceTier)
      if (variantServiceTier) return variantServiceTier
    }

    const modelServiceTier = normalizeServiceTierSetting(entry.serviceTier)
    if (modelServiceTier) return modelServiceTier
  }

  return undefined
}

export function resolveServiceTierForModel(input: {
  behaviorSettings?: BehaviorSettings
  modelOptions?: Record<string, unknown>
  modelCandidates: string[]
  variantCandidates: string[]
}): ServiceTierOption | undefined {
  const modelOverride = getModelServiceTierOverride(
    input.behaviorSettings,
    input.modelCandidates,
    input.variantCandidates
  )
  if (modelOverride) return modelOverride

  const customModelOverride = input.modelOptions
    ? getCustomModelServiceTierOverride(input.modelOptions, input.variantCandidates)
    : undefined
  if (customModelOverride) return customModelOverride

  return normalizeServiceTierSetting(input.behaviorSettings?.global?.serviceTier)
}
