import { describe, expect, it } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { loadSnapshots, saveSnapshots } from "../lib/codex-status-storage"

describe("codex-status storage", () => {
  it("writes and reads snapshots atomically", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-status-"))
    const p = path.join(dir, "snapshots.json")

    await saveSnapshots(p, (cur) => ({
      ...cur,
      "acc|u@e.com|plus": { updatedAt: 1, modelFamily: "gpt-5.2", limits: [{ name: "requests", leftPct: 50 }] }
    }))

    const next = await loadSnapshots(p)
    expect(next["acc|u@e.com|plus"]?.limits[0]?.leftPct).toBe(50)

    // Cleanup
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("handles missing file by returning empty object", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-status-missing-"))
    const p = path.join(dir, "nonexistent.json")
    
    const snapshots = await loadSnapshots(p)
    expect(snapshots).toEqual({})

    // Cleanup
    await fs.rm(dir, { recursive: true, force: true })
  })
})
