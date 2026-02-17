import { describe, expect, it } from "vitest"
import { CodexStatus } from "../lib/codex-status"

describe("CodexStatus", () => {
  it("stores and retrieves snapshots by identityKey", () => {
    const s = new CodexStatus()
    s.updateSnapshot("acc|u@e.com|plus", {
      updatedAt: 1000,
      modelFamily: "gpt-5.2",
      limits: [{ name: "5 hour", leftPct: 75, resetsAt: 1700000000000 }]
    })
    const snap = s.getSnapshot("acc|u@e.com|plus")
    expect(snap?.limits[0]?.leftPct).toBe(75)
  })

  it("returns all snapshots synchronously", () => {
    const s = new CodexStatus()
    const k = "acc|u@e.com|plus"
    const snap = {
      updatedAt: 1000,
      modelFamily: "gpt-5.2",
      limits: []
    }
    s.updateSnapshot(k, snap)

    const all = s.getAllSnapshots()
    expect(all[k]).toEqual(snap)
  })
})

describe("CodexStatus headers", () => {
  it("parses reset times and left percentage from headers", () => {
    const s = new CodexStatus()
    const now = 1000

    const snap = s.parseFromHeaders({
      now,
      modelFamily: "gpt-5.2",
      headers: {
        "x-ratelimit-remaining-requests": "75",
        "x-ratelimit-limit-requests": "100",
        "x-ratelimit-reset-requests": "1700"
      }
    })

    expect(snap.limits[0]?.leftPct).toBe(75)
    expect(snap.limits[0]?.resetsAt).toBe(1700 * 1000)
  })

  it("parses reset time values in milliseconds", () => {
    const s = new CodexStatus()
    const snap = s.parseFromHeaders({
      now: 1000,
      modelFamily: "gpt-5.2",
      headers: {
        "x-ratelimit-remaining-requests": "75",
        "x-ratelimit-limit-requests": "100",
        "x-ratelimit-reset-requests": "1700000000000"
      }
    })

    expect(snap.limits[0]?.resetsAt).toBe(1700000000000)
  })

  it("parses reset time values with duration suffixes", () => {
    const s = new CodexStatus()
    const seconds = s.parseFromHeaders({
      now: 1000,
      modelFamily: "gpt-5.2",
      headers: {
        "x-ratelimit-remaining-requests": "75",
        "x-ratelimit-limit-requests": "100",
        "x-ratelimit-reset-requests": "1.5s"
      }
    })
    const millis = s.parseFromHeaders({
      now: 1000,
      modelFamily: "gpt-5.2",
      headers: {
        "x-ratelimit-remaining-requests": "75",
        "x-ratelimit-limit-requests": "100",
        "x-ratelimit-reset-requests": "1500ms"
      }
    })

    expect(seconds.limits[0]?.resetsAt).toBe(2500)
    expect(millis.limits[0]?.resetsAt).toBe(2500)
  })

  it("handles missing headers gracefully", () => {
    const s = new CodexStatus()
    const snap = s.parseFromHeaders({
      now: 1000,
      modelFamily: "gpt-4",
      headers: {}
    })
    expect(snap.limits).toHaveLength(0)
  })

  it("handles non-finite header values", () => {
    const s = new CodexStatus()
    const snap = s.parseFromHeaders({
      now: 1000,
      modelFamily: "gpt-4",
      headers: {
        "x-ratelimit-remaining-requests": "NaN",
        "x-ratelimit-limit-requests": "100"
      }
    })
    expect(snap.limits).toHaveLength(0)
  })
})
