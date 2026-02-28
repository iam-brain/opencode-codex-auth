import { describe, expect, it } from "vitest"
import lockfile from "proper-lockfile"

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { loadSnapshots, saveSnapshots } from "../lib/codex-status-storage"
import { lockTargetPathForFile } from "../lib/cache-lock"

function isFsErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}

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
    const mode = (await fs.stat(p)).mode & 0o777
    if (process.platform !== "win32") {
      expect(mode).toBe(0o600)
    }

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
    const lockTarget = lockTargetPathForFile(p)
    await fs.writeFile(lockTarget, "", { mode: 0o600 })
    const release = await lockfile.lock(lockTarget, { realpath: true, retries: 0 })

    let enteredUpdate = false
    const promise = saveSnapshots(p, (cur) => {
      enteredUpdate = true
      return {
        ...cur,
        locked: { updatedAt: 99, modelFamily: "test", limits: [] }
      }
    })

    await Promise.resolve()
    expect(enteredUpdate).toBe(false)
    await expect(fs.stat(p)).rejects.toMatchObject({ code: "ENOENT" })

    // Release the lock
    await release()

    const result = await promise
    expect(enteredUpdate).toBe(true)
    expect(result.locked?.updatedAt).toBe(99)
    await fs.stat(p)

    // Cleanup
    await fs.rm(dir, { recursive: true, force: true })
  })

  it("skips writing when snapshot content is unchanged", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-status-noop-"))
    const p = path.join(dir, "snapshots.json")

    await saveSnapshots(p, () => ({
      "acc|u@e.com|plus": { updatedAt: 1, modelFamily: "gpt-5.2", limits: [{ name: "requests", leftPct: 50 }] }
    }))

    const beforeRaw = await fs.readFile(p, "utf8")

    await saveSnapshots(p, (cur) => ({ ...cur }))

    const afterRaw = await fs.readFile(p, "utf8")
    expect(afterRaw).toBe(beforeRaw)

    await fs.rm(dir, { recursive: true, force: true })
  })
})
