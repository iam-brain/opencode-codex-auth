import type { CodexLimit, CodexRateLimitSnapshot } from "./types.js"

function findLimitByName(snapshot: CodexRateLimitSnapshot, names: string[]): CodexLimit | undefined {
  const lowered = new Set(names.map((name) => name.toLowerCase()))
  return snapshot.limits.find((limit) => lowered.has(limit.name.toLowerCase()))
}

export function resolveQuotaWindows(snapshot: CodexRateLimitSnapshot | undefined): {
  fiveHour?: CodexLimit
  weekly?: CodexLimit
} {
  if (!snapshot) return {}

  const semanticWeekly = findLimitByName(snapshot, ["weekly"])
  const semanticFiveHour = findLimitByName(snapshot, ["5h"])
  const legacyWeekly = findLimitByName(snapshot, ["secondary", "tokens"])
  const legacyFiveHour = findLimitByName(snapshot, ["primary", "requests"])
  const weekly = semanticWeekly ?? legacyWeekly
  const fiveHour = semanticFiveHour ?? legacyFiveHour ?? snapshot.limits.find((limit) => limit !== weekly)

  return {
    fiveHour,
    weekly: weekly ?? snapshot.limits.find((limit) => limit !== fiveHour)
  }
}
