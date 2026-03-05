import type { BehaviorSettings, ServiceTierOption } from "../config.js"
import { isRecord } from "../util.js"
import { asString, EFFORT_SUFFIX_REGEX } from "./request-transform-shared.js"

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
  if (normalized === "default" || normalized === "priority" || normalized === "flex") {
    return normalized
  }
  return undefined
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

  for (const candidate of modelCandidates) {
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
  modelCandidates: string[]
  variantCandidates: string[]
}): ServiceTierOption | undefined {
  const modelOverride = getModelServiceTierOverride(
    input.behaviorSettings,
    input.modelCandidates,
    input.variantCandidates
  )
  if (modelOverride) return modelOverride

  return normalizeServiceTierSetting(input.behaviorSettings?.global?.serviceTier)
}
