import { describe, expect, it } from "vitest"
import { CodexStatus } from "../lib/codex-status"

describe("CodexStatus", () => {
  it("stores and retrieves snapshots by identityKey", async () => {
    const s = new CodexStatus()
    await s.updateSnapshot("acc|u@e.com|plus", {
      updatedAt: 1000,
      modelFamily: "gpt-5.2",
      limits: [
        { name: "5 hour", leftPct: 75, resetsAt: 1700000000000 }
      ]
    })
    const snap = await s.getSnapshot("acc|u@e.com|plus")
    expect(snap?.limits[0]?.leftPct).toBe(75)
  })
})
