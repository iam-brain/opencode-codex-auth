export const EFFORT_SUFFIX_REGEX = /-(none|minimal|low|medium|high|xhigh)$/i

export function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

export function normalizeReasoningSummaryOption(value: unknown): "auto" | "concise" | "detailed" | undefined {
  const normalized = asString(value)?.toLowerCase()
  if (!normalized || normalized === "none") return undefined
  if (normalized === "auto" || normalized === "concise" || normalized === "detailed") return normalized
  return undefined
}

export function normalizeTextVerbosity(value: unknown): "low" | "medium" | "high" | undefined {
  const normalized = asString(value)?.toLowerCase()
  if (!normalized) return undefined
  if (normalized === "low" || normalized === "medium" || normalized === "high") return normalized
  return undefined
}

export function normalizeVerbositySetting(value: unknown): "default" | "low" | "medium" | "high" | undefined {
  const normalized = asString(value)?.toLowerCase()
  if (!normalized) return undefined
  if (normalized === "default" || normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized
  }
  return undefined
}

export function mergeUnique(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}
