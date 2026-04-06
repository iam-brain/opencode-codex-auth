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

function mockUnavailableProperLockfile() {
  vi.doMock("proper-lockfile", () => {
    throw new Error("module unavailable")
  })
  vi.doMock("proper-lockfile/index.js", () => {
    throw new Error("subpath unavailable")
  })
}

function mockProperLockfileNamespace(lock: (...args: Array<unknown>) => Promise<() => Promise<void>>) {
  vi.doMock("proper-lockfile", () => ({ lock }))
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.doUnmock("proper-lockfile")
  vi.doUnmock("proper-lockfile/index.js")
  vi.doUnmock("node:fs/promises")
  vi.useRealTimers()
  vi.resetModules()

  const dirs = [...createdTempDirs]
  createdTempDirs.clear()
  await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("cache lock", () => {
  it("resolves lock functions from direct and nested module shapes", async () => {
    const { __cacheLockTest } = await import("../lib/cache-lock")
    const lock = vi.fn(async () => async () => {})

    expect(__cacheLockTest.resolveLockFunction(lock)).toBe(lock)
    expect(__cacheLockTest.resolveLockFunction({ default: { lock } })).toBe(lock)
    expect(__cacheLockTest.resolveLockFunction({ module: { lock } })).toBe(lock)
    expect(__cacheLockTest.resolveLockFunction({ exports: { lock } })).toBe(lock)
    expect(__cacheLockTest.resolveLockFunction(null)).toBeUndefined()

    const cyclic: Record<string, unknown> = {}
    cyclic.default = cyclic
    expect(__cacheLockTest.resolveLockFunction(cyclic)).toBeUndefined()
  })

  it("normalizes retry and stale option values defensively", async () => {
    const { __cacheLockTest } = await import("../lib/cache-lock")

    expect(__cacheLockTest.toRetryOptions(undefined)).toEqual({
      retries: 0,
      minTimeout: 50,
      maxTimeout: 200
    })
    expect(__cacheLockTest.toRetryOptions({})).toEqual({
      retries: 0,
      minTimeout: 50,
      maxTimeout: 200
    })
    expect(
      __cacheLockTest.toRetryOptions({
        retries: -3.4,
        minTimeout: 0,
        maxTimeout: 0
      })
    ).toEqual({
      retries: 0,
      minTimeout: 1,
      maxTimeout: 1
    })
    expect(
      __cacheLockTest.toRetryOptions({
        retries: "bad",
        minTimeout: "bad",
        maxTimeout: "bad"
      })
    ).toEqual({
      retries: 0,
      minTimeout: 50,
      maxTimeout: 200
    })
    expect(__cacheLockTest.resolveLockOptions({ staleMs: 3.9 })).toMatchObject({ stale: 3 })
    expect(__cacheLockTest.resolveLockOptions()).toMatchObject({
      realpath: true,
      retries: {
        retries: 20,
        minTimeout: 10,
        maxTimeout: 100
      }
    })
    expect(__cacheLockTest.resolveLockOptions()).not.toHaveProperty("stale")
  })

  it("uses a CommonJS-style lock export without requiring a default export", async () => {
    vi.resetModules()
    const lock = vi.fn(async () => async () => {})
    mockProperLockfileNamespace(lock)

    const { lockTargetPathForFile, withLockedFile } = await import("../lib/cache-lock")
    const root = await createTempDir("opencode-cache-lock-")
    const filePath = path.join(root, "cache.json")

    await expect(withLockedFile(filePath, async () => "ok")).resolves.toBe("ok")
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

  it("loads the plugin entry when proper-lockfile resolves to a CommonJS-style namespace", async () => {
    vi.resetModules()
    mockProperLockfileNamespace(vi.fn(async () => async () => {}))

    const pluginEntry = await import("../index")
    expect(typeof pluginEntry.OpenAIMultiAuthPlugin).toBe("function")
  })

  it("locks directories with a resolved lock function", async () => {
    vi.resetModules()
    const release = vi.fn(async () => {})
    mockProperLockfileNamespace(vi.fn(async () => release))

    const { withLockedDirectory } = await import("../lib/cache-lock")
    const root = await createTempDir("opencode-cache-lock-dir-")
    const directoryPath = path.join(root, "nested")

    await expect(withLockedDirectory(directoryPath, async () => "dir-ok", { staleMs: 9 })).resolves.toBe("dir-ok")
    expect(release).toHaveBeenCalledTimes(1)
  })

  it("returns undefined when a lock module cannot be imported", async () => {
    const { __cacheLockTest } = await import("../lib/cache-lock")

    expect(await __cacheLockTest.resolveImportedLockFunction("missing-lock-module")).toBeUndefined()
  })

  it("rethrows non-ENOENT owner reads", async () => {
    const readFileSpy = vi
      .spyOn(fs, "readFile")
      .mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "EPERM" }))

    const { __cacheLockTest } = await import("../lib/cache-lock")

    await expect(__cacheLockTest.hasDirectoryLockOwner("/tmp/missing-lock", "owner-token")).rejects.toMatchObject({
      code: "EPERM"
    })
    expect(readFileSpy).toHaveBeenCalledTimes(1)
  })

  it("falls back to directory locks when proper-lockfile imports are unavailable", async () => {
    vi.resetModules()
    mockUnavailableProperLockfile()

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

  it("keeps exclusivity instead of reaping a long-held fallback lock", async () => {
    vi.resetModules()
    mockUnavailableProperLockfile()

    const { withLockedFile } = await import("../lib/cache-lock")
    const root = await createTempDir("opencode-cache-lock-")
    const filePath = path.join(root, "active-target.json")

    let releaseFirst!: () => void
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    let firstEntered = false
    const firstLock = withLockedFile(
      filePath,
      async () => {
        firstEntered = true
        await firstDone
      },
      { staleMs: 20 }
    )

    while (!firstEntered) {
      await sleep(5)
    }

    await sleep(60)

    let secondEntered = false
    const secondLock = withLockedFile(
      filePath,
      async () => {
        secondEntered = true
      },
      { staleMs: 20 }
    )

    await sleep(60)
    expect(secondEntered).toBe(false)

    releaseFirst()
    await firstLock
    await secondLock
    expect(secondEntered).toBe(true)
  })

  it("retries fallback locking until the directory becomes available", async () => {
    vi.resetModules()
    mockUnavailableProperLockfile()

    const actualMkdir = fs.mkdir.bind(fs)
    const root = await createTempDir("opencode-cache-lock-")
    const targetPath = path.join(root, "retry-target")
    const mkdirSpy = vi
      .spyOn(fs, "mkdir")
      .mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EEXIST" }))
      .mockImplementationOnce(actualMkdir)

    const { __cacheLockTest } = await import("../lib/cache-lock")
    const release = await __cacheLockTest.lockWithDirectoryFallback(targetPath, {
      retries: { retries: 1, minTimeout: 1, maxTimeout: 1 }
    })

    expect(mkdirSpy).toHaveBeenCalledTimes(2)
    await expect(release()).resolves.toBeUndefined()
  })

  it("swallows ENOENT when a fallback lock directory is already gone during release", async () => {
    vi.resetModules()
    mockUnavailableProperLockfile()

    const { __cacheLockTest } = await import("../lib/cache-lock")
    const root = await createTempDir("opencode-cache-lock-")
    const targetPath = path.join(root, "release-target")
    const lockDir = `${targetPath}.lock`
    const release = await __cacheLockTest.lockWithDirectoryFallback(targetPath, {
      retries: { retries: 0, minTimeout: 1, maxTimeout: 1 }
    })

    await fs.rm(lockDir, { recursive: true, force: true })
    await expect(release()).resolves.toBeUndefined()
  })

  it("removes a fallback lock directory when writing owner metadata fails", async () => {
    vi.resetModules()
    mockUnavailableProperLockfile()

    const writeFileSpy = vi
      .spyOn(fs, "writeFile")
      .mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "EPERM" }))
    const rmSpy = vi.spyOn(fs, "rm")

    const { __cacheLockTest } = await import("../lib/cache-lock")
    const root = await createTempDir("opencode-cache-lock-")
    const targetPath = path.join(root, "owner-write-error-target")
    const lockDir = `${targetPath}.lock`

    await expect(
      __cacheLockTest.lockWithDirectoryFallback(targetPath, {
        retries: { retries: 0, minTimeout: 1, maxTimeout: 1 }
      })
    ).rejects.toMatchObject({ code: "EPERM" })
    expect(writeFileSpy).toHaveBeenCalledTimes(1)
    expect(rmSpy).toHaveBeenCalledWith(lockDir, { recursive: true, force: true })
    await expect(fs.access(lockDir)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("rethrows non-ENOENT release errors from fallback locks", async () => {
    vi.resetModules()
    mockUnavailableProperLockfile()

    const rmSpy = vi.spyOn(fs, "rm").mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "EPERM" }))

    const { __cacheLockTest } = await import("../lib/cache-lock")
    const root = await createTempDir("opencode-cache-lock-")
    const targetPath = path.join(root, "release-error-target")
    const release = await __cacheLockTest.lockWithDirectoryFallback(targetPath, {
      retries: { retries: 0, minTimeout: 1, maxTimeout: 1 }
    })

    await expect(release()).rejects.toMatchObject({ code: "EPERM" })
    expect(rmSpy).toHaveBeenCalledTimes(1)
  })

  it("does not remove a replacement fallback lock owned by someone else", async () => {
    vi.resetModules()
    mockUnavailableProperLockfile()

    const { __cacheLockTest } = await import("../lib/cache-lock")
    const root = await createTempDir("opencode-cache-lock-")
    const targetPath = path.join(root, "replacement-owner-target")
    const lockDir = `${targetPath}.lock`
    const release = await __cacheLockTest.lockWithDirectoryFallback(targetPath, {
      retries: { retries: 0, minTimeout: 1, maxTimeout: 1 }
    })

    await fs.rm(lockDir, { recursive: true, force: true })
    await fs.mkdir(lockDir)
    await __cacheLockTest.writeDirectoryLockOwner(lockDir, "other-owner")

    await expect(release()).resolves.toBeUndefined()
    await expect(fs.access(lockDir)).resolves.toBeUndefined()
  })

  it("throws fallback errors that are not lock contention", async () => {
    vi.resetModules()
    mockUnavailableProperLockfile()

    const { __cacheLockTest } = await import("../lib/cache-lock")
    await expect(
      __cacheLockTest.lockWithDirectoryFallback(path.join("/dev/null", "child"), {
        retries: { retries: 0, minTimeout: 1, maxTimeout: 1 }
      })
    ).rejects.toMatchObject({ code: "ENOTDIR" })
  })

  it("fails fallback locking once retries are exhausted", async () => {
    vi.resetModules()
    mockUnavailableProperLockfile()

    const { __cacheLockTest } = await import("../lib/cache-lock")
    const root = await createTempDir("opencode-cache-lock-")
    const targetPath = path.join(root, "exhausted-target")
    await fs.mkdir(`${targetPath}.lock`)

    await expect(
      __cacheLockTest.lockWithDirectoryFallback(targetPath, {
        retries: { retries: 0, minTimeout: 1, maxTimeout: 1 }
      })
    ).rejects.toMatchObject({ code: "EEXIST" })
  })
})
