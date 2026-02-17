import { describe, expect, it } from "vitest"

import {
  DEFAULT_QUOTA_THRESHOLD_TRACKER_STATE,
  evaluateQuotaThresholds,
  type QuotaThresholdTrackerState
} from "../lib/quota-threshold-alerts"

function snapshot(input: {
  requests?: { leftPct: number; resetsAt?: number }
  weekly?: { leftPct: number; resetsAt?: number }
}) {
  const limits: Array<{ name: string; leftPct: number; resetsAt?: number }> = []
  if (input.requests) limits.push({ name: "requests", ...input.requests })
  if (input.weekly) limits.push({ name: "tokens", ...input.weekly })
  return {
    updatedAt: Date.now(),
    modelFamily: "gpt-5.3-codex",
    limits
  }
}

describe("quota threshold alerts", () => {
  it("emits progressive threshold warnings and exhausted crossing", () => {
    let state: QuotaThresholdTrackerState = DEFAULT_QUOTA_THRESHOLD_TRACKER_STATE

    const first = evaluateQuotaThresholds({
      snapshot: snapshot({ requests: { leftPct: 24 }, weekly: { leftPct: 100 } }),
      previousState: state
    })
    state = first.nextState
    expect(first.warnings.map((warning) => warning.thresholdPct)).toEqual([25])
    expect(first.exhaustedCrossings).toEqual([])

    const second = evaluateQuotaThresholds({
      snapshot: snapshot({ requests: { leftPct: 18 }, weekly: { leftPct: 100 } }),
      previousState: state
    })
    state = second.nextState
    expect(second.warnings.map((warning) => warning.thresholdPct)).toEqual([20])

    const exhausted = evaluateQuotaThresholds({
      snapshot: snapshot({ requests: { leftPct: 0, resetsAt: 1_710_000_000_000 }, weekly: { leftPct: 100 } }),
      previousState: state
    })
    expect(exhausted.warnings.map((warning) => warning.thresholdPct)).toEqual([0])
    expect(exhausted.exhaustedCrossings).toEqual([
      {
        window: "five_hour",
        resetsAt: 1_710_000_000_000,
        reasonCode: "quota_limit_exhausted_5h"
      }
    ])
  })

  it("labels weekly warnings and does not re-emit unchanged threshold", () => {
    const first = evaluateQuotaThresholds({
      snapshot: snapshot({ requests: { leftPct: 90 }, weekly: { leftPct: 4 } }),
      previousState: DEFAULT_QUOTA_THRESHOLD_TRACKER_STATE
    })

    expect(first.warnings).toHaveLength(1)
    expect(first.warnings[0]?.window).toBe("weekly")
    expect(first.warnings[0]?.thresholdPct).toBe(5)
    expect(first.warnings[0]?.message).toContain("weekly")

    const second = evaluateQuotaThresholds({
      snapshot: snapshot({ requests: { leftPct: 90 }, weekly: { leftPct: 4 } }),
      previousState: first.nextState
    })
    expect(second.warnings).toEqual([])
  })

  it("detects weekly exhaustion crossing", () => {
    const evaluated = evaluateQuotaThresholds({
      snapshot: snapshot({ requests: { leftPct: 80 }, weekly: { leftPct: 0, resetsAt: 1_711_000_000_000 } }),
      previousState: DEFAULT_QUOTA_THRESHOLD_TRACKER_STATE
    })

    expect(evaluated.exhaustedCrossings).toEqual([
      {
        window: "weekly",
        resetsAt: 1_711_000_000_000,
        reasonCode: "quota_limit_exhausted_weekly"
      }
    ])
  })
})
