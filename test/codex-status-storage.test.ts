import { describe, expect, it } from "vitest"
import lockfile from "proper-lockfile"

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

  it("handles corrupt JSON by returning empty object", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-status-corrupt-"))
    const p = path.join(dir, "snapshots.json")
    await fs.writeFile(p, "{not-json", { mode: 0o600 })

    const snapshots = await loadSnapshots(p)
    expect(snapshots).toEqual({})

    await fs.rm(dir, { recursive: true, force: true })
  })

  it("does not write snapshots file before acquiring lock", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-status-lock-order-"))
    const p = path.join(dir, "snapshots.json")

    // Ensure parent dir exists
    await fs.mkdir(dir, { recursive: true })

    // Acquire lock on a *missing* snapshots path
    const release = await lockfile.lock(p, { realpath: false, retries: 0 })

    // Start saveSnapshots without awaiting it
    const promise = saveSnapshots(p, (cur) => ({
      ...cur,
      locked: { updatedAt: 99, modelFamily: "test", limits: [] }
    }))

    // Wait a small amount of time
    await new Promise(r => setTimeout(r, 25))

    // Assert the snapshots file still does NOT exist yet
    let exists = true
    try {
      await fs.stat(p)
    } catch {
      exists = false
    }

    // Capture state before releasing lock
    const existsWhileLocked = exists

    // Release the lock
    await release()

    // Await the pending promise
    const result = await promise
    expect(result.locked?.updatedAt).toBe(99)

    // Verify it exists now
    await fs.stat(p)

    // The bug is that existsWhileLocked will be true with the current implementation
    expect(existsWhileLocked).toBe(false)

    // Cleanup
    await fs.rm(dir, { recursive: true, force: true })
  })
})
