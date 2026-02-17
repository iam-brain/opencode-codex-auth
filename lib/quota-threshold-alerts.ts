import type { CodexLimit, CodexRateLimitSnapshot } from "./types"

export const QUOTA_WARNING_THRESHOLDS_PCT = [25, 20, 10, 5, 2.5, 0] as const

export type QuotaWindowKind = "five_hour" | "weekly"

export type QuotaThresholdTrackerState = {
  fiveHourThresholdIndex: number
  weeklyThresholdIndex: number
  fiveHourExhausted: boolean
  weeklyExhausted: boolean
}

export type QuotaThresholdWarning = {
  window: QuotaWindowKind
  thresholdPct: number
  message: string
  reasonCode: string
}

export type QuotaExhaustedCrossing = {
  window: QuotaWindowKind
  resetsAt?: number
  reasonCode: string
}

export type QuotaThresholdEvaluation = {
  nextState: QuotaThresholdTrackerState
  warnings: QuotaThresholdWarning[]
  exhaustedCrossings: QuotaExhaustedCrossing[]
}

export const DEFAULT_QUOTA_THRESHOLD_TRACKER_STATE: QuotaThresholdTrackerState = {
  fiveHourThresholdIndex: -1,
  weeklyThresholdIndex: -1,
  fiveHourExhausted: false,
  weeklyExhausted: false
}

function formatPct(value: number): string {
  return Number.isInteger(value) ? `${value}` : `${value}`
}

function sanitizeReasonPct(value: number): string {
  return formatPct(value).replace(".", "_")
}

function findLimitByName(snapshot: CodexRateLimitSnapshot, names: string[]): CodexLimit | undefined {
  const lowered = names.map((name) => name.toLowerCase())
  return snapshot.limits.find((limit) => lowered.includes(limit.name.toLowerCase()))
}

function resolveQuotaWindows(snapshot: CodexRateLimitSnapshot): {
  fiveHour?: CodexLimit
  weekly?: CodexLimit
} {
  const fiveHour = findLimitByName(snapshot, ["5h", "primary", "requests"]) ?? snapshot.limits[0]
  const weekly =
    findLimitByName(snapshot, ["weekly", "secondary", "tokens"]) ??
    snapshot.limits.find((limit) => limit !== fiveHour && limit.name.toLowerCase() !== fiveHour?.name.toLowerCase())
  return { fiveHour, weekly }
}

function findHighestReachedThresholdIndex(leftPct: number): number {
  let highest = -1
  for (let i = 0; i < QUOTA_WARNING_THRESHOLDS_PCT.length; i += 1) {
    if (leftPct <= QUOTA_WARNING_THRESHOLDS_PCT[i]) {
      highest = i
    }
  }
  return highest
}

function maybeBuildWarning(input: {
  previousIndex: number
  nextIndex: number
  window: QuotaWindowKind
}): QuotaThresholdWarning | null {
  if (input.nextIndex <= input.previousIndex || input.nextIndex < 0) return null
  const thresholdPct = QUOTA_WARNING_THRESHOLDS_PCT[input.nextIndex]
  const label = input.window === "weekly" ? "weekly" : "5h"
  return {
    window: input.window,
    thresholdPct,
    message: `Heads up, you have less than ${formatPct(thresholdPct)}% of your ${label} quota left.`,
    reasonCode: `quota_${label}_remaining_below_${sanitizeReasonPct(thresholdPct)}pct`
  }
}

export function evaluateQuotaThresholds(input: {
  snapshot: CodexRateLimitSnapshot
  previousState?: QuotaThresholdTrackerState
}): QuotaThresholdEvaluation {
  const previousState = input.previousState ?? DEFAULT_QUOTA_THRESHOLD_TRACKER_STATE
  const windows = resolveQuotaWindows(input.snapshot)
  const warnings: QuotaThresholdWarning[] = []
  const exhaustedCrossings: QuotaExhaustedCrossing[] = []

  const fiveHourLeftPct = windows.fiveHour?.leftPct
  const weeklyLeftPct = windows.weekly?.leftPct

  const fiveHourThresholdIndex =
    typeof fiveHourLeftPct === "number"
      ? findHighestReachedThresholdIndex(fiveHourLeftPct)
      : previousState.fiveHourThresholdIndex
  const weeklyThresholdIndex =
    typeof weeklyLeftPct === "number" ? findHighestReachedThresholdIndex(weeklyLeftPct) : previousState.weeklyThresholdIndex

  const fiveHourWarning = maybeBuildWarning({
    previousIndex: previousState.fiveHourThresholdIndex,
    nextIndex: fiveHourThresholdIndex,
    window: "five_hour"
  })
  if (fiveHourWarning) warnings.push(fiveHourWarning)

  const weeklyWarning = maybeBuildWarning({
    previousIndex: previousState.weeklyThresholdIndex,
    nextIndex: weeklyThresholdIndex,
    window: "weekly"
  })
  if (weeklyWarning) warnings.push(weeklyWarning)

  const fiveHourExhausted = typeof fiveHourLeftPct === "number" ? fiveHourLeftPct <= 0 : previousState.fiveHourExhausted
  const weeklyExhausted = typeof weeklyLeftPct === "number" ? weeklyLeftPct <= 0 : previousState.weeklyExhausted

  if (fiveHourExhausted && !previousState.fiveHourExhausted) {
    exhaustedCrossings.push({
      window: "five_hour",
      resetsAt: windows.fiveHour?.resetsAt,
      reasonCode: "quota_limit_exhausted_5h"
    })
  }
  if (weeklyExhausted && !previousState.weeklyExhausted) {
    exhaustedCrossings.push({
      window: "weekly",
      resetsAt: windows.weekly?.resetsAt,
      reasonCode: "quota_limit_exhausted_weekly"
    })
  }

  return {
    nextState: {
      fiveHourThresholdIndex,
      weeklyThresholdIndex,
      fiveHourExhausted,
      weeklyExhausted
    },
    warnings,
    exhaustedCrossings
  }
}
