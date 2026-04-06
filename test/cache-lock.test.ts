import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

const createdTempDirs = new Set<string>()

async function createTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  createdTempDirs.add(dir)
  return dir
}

afterEach(async () => {
  vi.doUnmock("proper-lockfile")
  vi.doUnmock("proper-lockfile/index.js")
  vi.resetModules()

  const dirs = [...createdTempDirs]
  createdTempDirs.clear()
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("cache lock", () => {
  it("uses a CommonJS-style lock export without requiring a default export", async () => {
    const lock = vi.fn(async () => async () => {})
    vi.doMock("proper-lockfile", () => ({ lock }))

    const { lockTargetPathForFile, withLockedFile } = await import("../lib/cache-lock")
    const root = await createTempDir("opencode-cache-lock-")
    const filePath = path.join(root, "cache.json")

    let entered = false
    const result = await withLockedFile(filePath, async () => {
      entered = true
      return "ok"
    })

    expect(result).toBe("ok")
    expect(entered).toBe(true)
    expect(lock).toHaveBeenCalledTimes(1)
    expect(lock).toHaveBeenCalledWith(
      lockTargetPathForFile(filePath),
      expect.objectContaining({
        realpath: true,
        retries: {
          retries: 20,
          minTimeout: 10,
          maxTimeout: 100
        }
      })
    )
  })

  it("falls back to directory locks when proper-lockfile imports are unavailable", async () => {
    vi.doMock("proper-lockfile", () => {
      throw new Error("module unavailable")
    })
    vi.doMock("proper-lockfile/index.js", () => {
      throw new Error("subpath unavailable")
    })

    const { lockTargetPathForFile, withLockedFile } = await import("../lib/cache-lock")
    const root = await createTempDir("opencode-cache-lock-")
    const filePath = path.join(root, "snapshots.json")
    const lockDir = `${lockTargetPathForFile(filePath)}.lock`

    let sawLockDir = false
    await withLockedFile(filePath, async () => {
      await expect(fs.access(lockDir)).resolves.toBeUndefined()
      sawLockDir = true
    })

    expect(sawLockDir).toBe(true)
    await expect(fs.access(lockDir)).rejects.toMatchObject({ code: "ENOENT" })
  })
})
