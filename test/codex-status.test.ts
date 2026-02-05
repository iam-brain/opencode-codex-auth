import { describe, expect, it } from "vitest"
import { CodexStatus } from "../lib/codex-status"

describe("CodexStatus", () => {
  it("stores and retrieves snapshots by identityKey", () => {
    const s = new CodexStatus()
    s.updateSnapshot("acc|u@e.com|plus", {
      updatedAt: 1000,
      modelFamily: "gpt-5.2",
      limits: [
        { name: "5 hour", leftPct: 75, resetsAt: 1700000000000 }
      ]
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
