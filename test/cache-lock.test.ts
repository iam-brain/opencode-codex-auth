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

  it("locks directories with a resolved lock function", async () => {
    vi.resetModules()
    const release = vi.fn(async () => {})
    const lock = vi.fn(async () => release)
    vi.doMock("proper-lockfile", () => ({ lock }))

    const { withLockedDirectory } = await import("../lib/cache-lock")
    const root = await createTempDir("opencode-cache-lock-dir-")
    const directoryPath = path.join(root, "nested")

    await expect(withLockedDirectory(directoryPath, async () => "dir-ok", { staleMs: 9 })).resolves.toBe("dir-ok")
    expect(lock).toHaveBeenCalledWith(
      directoryPath,
      expect.objectContaining({
        stale: 9
      })
    )
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

    await expect(__cacheLockTest.hasDirectoryLockOwner("/tmp/missing-lock", "owner")).rejects.toMatchObject({
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

  it("updates the lock heartbeat while holding a fallback lock", async () => {
    vi.resetModules()
    mockUnavailableProperLockfile()

    let heartbeatCallback: (() => void) | undefined
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: TimerHandler) => {
      heartbeatCallback = callback as () => void
      return 1 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout)
    vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => {})
    const utimesSpy = vi.spyOn(fs, "utimes").mockResolvedValueOnce(undefined)

    const { __cacheLockTest } = await import("../lib/cache-lock")
    const root = await createTempDir("opencode-cache-lock-")
    const targetPath = path.join(root, "heartbeat-target")
    const release = await __cacheLockTest.lockWithDirectoryFallback(targetPath, {
      stale: 20,
      retries: { retries: 0, minTimeout: 1, maxTimeout: 1 }
    })

    heartbeatCallback?.()
    await vi.waitFor(() => {
      expect(utimesSpy).toHaveBeenCalledTimes(1)
    })
    await expect(release()).resolves.toBeUndefined()
  })

  it("stops heartbeat writes when utimes sees ENOENT", async () => {
    vi.resetModules()
    mockUnavailableProperLockfile()

    const heartbeatCallbacks: Array<() => void> = []
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: TimerHandler) => {
      heartbeatCallbacks.push(callback as () => void)
      return heartbeatCallbacks.length as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout)
    vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => {})
    const utimesSpy = vi.spyOn(fs, "utimes").mockRejectedValueOnce(Object.assign(new Error("gone"), { code: "ENOENT" }))

    const { __cacheLockTest } = await import("../lib/cache-lock")
    const root = await createTempDir("opencode-cache-lock-")
    const targetPath = path.join(root, "heartbeat-enoent-target")
    const release = await __cacheLockTest.lockWithDirectoryFallback(targetPath, {
      stale: 20,
      retries: { retries: 0, minTimeout: 1, maxTimeout: 1 }
    })

    heartbeatCallbacks[0]?.()
    await vi.waitFor(() => {
      expect(utimesSpy).toHaveBeenCalledTimes(1)
    })
    expect(heartbeatCallbacks).toHaveLength(1)
    await expect(release()).resolves.toBeUndefined()
  })

  it("stops heartbeat writes after fallback lock ownership changes", async () => {
    vi.resetModules()
    mockUnavailableProperLockfile()

    const heartbeatCallbacks: Array<() => void> = []
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: TimerHandler) => {
      heartbeatCallbacks.push(callback as () => void)
      return heartbeatCallbacks.length as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout)
    vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => {})
    const readFileSpy = vi.spyOn(fs, "readFile")
    const utimesSpy = vi.spyOn(fs, "utimes")

    const { __cacheLockTest } = await import("../lib/cache-lock")
    const root = await createTempDir("opencode-cache-lock-")
    const targetPath = path.join(root, "heartbeat-owner-target")
    const lockDir = `${targetPath}.lock`
    const release = await __cacheLockTest.lockWithDirectoryFallback(targetPath, {
      stale: 20,
      retries: { retries: 0, minTimeout: 1, maxTimeout: 1 }
    })

    await __cacheLockTest.writeDirectoryLockOwner(lockDir, "other-owner")
    heartbeatCallbacks[0]?.()
    await vi.waitFor(() => {
      expect(readFileSpy).toHaveBeenCalled()
    })
    expect(utimesSpy).not.toHaveBeenCalled()
    await expect(release()).resolves.toBeUndefined()
    await expect(fs.access(lockDir)).resolves.toBeUndefined()
  })

  it("surfaces non-ENOENT heartbeat failures", async () => {
    vi.resetModules()
    mockUnavailableProperLockfile()

    let heartbeatCallback: (() => void) | undefined
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: TimerHandler) => {
      heartbeatCallback = callback as () => void
      return 1 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout)
    vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => {})
    const utimesSpy = vi
      .spyOn(fs, "utimes")
      .mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "EPERM" }))

    const { __cacheLockTest } = await import("../lib/cache-lock")
    const root = await createTempDir("opencode-cache-lock-")
    const targetPath = path.join(root, "heartbeat-error-target")
    const release = await __cacheLockTest.lockWithDirectoryFallback(targetPath, {
      stale: 20,
      retries: { retries: 0, minTimeout: 1, maxTimeout: 1 }
    })

    heartbeatCallback?.()
    await vi.waitFor(() => {
      expect(utimesSpy).toHaveBeenCalledTimes(1)
    })
    await expect(release()).rejects.toMatchObject({ code: "EPERM" })
  })

  it("skips heartbeat work after a fallback lock has already been released", async () => {
    vi.resetModules()
    mockUnavailableProperLockfile()

    let heartbeatCallback: (() => void) | undefined
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: TimerHandler) => {
      heartbeatCallback = callback as () => void
      return 1 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout)
    vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => {})
    const utimesSpy = vi.spyOn(fs, "utimes")

    const { __cacheLockTest } = await import("../lib/cache-lock")
    const root = await createTempDir("opencode-cache-lock-")
    const targetPath = path.join(root, "heartbeat-released-target")
    const release = await __cacheLockTest.lockWithDirectoryFallback(targetPath, {
      stale: 20,
      retries: { retries: 0, minTimeout: 1, maxTimeout: 1 }
    })

    const releasePromise = release()
    heartbeatCallback?.()
    await expect(releasePromise).resolves.toBeUndefined()
    expect(utimesSpy).not.toHaveBeenCalled()
  })

  it("skips heartbeat writes after the fallback lock has already been released", async () => {
    vi.resetModules()
    mockUnavailableProperLockfile()

    let heartbeatCallback: (() => void) | undefined
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: TimerHandler) => {
      heartbeatCallback = callback as () => void
      return 1 as unknown as ReturnType<typeof setTimeout>
    }) as unknown as typeof setTimeout)
    vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => {})
    const utimesSpy = vi.spyOn(fs, "utimes")

    const { __cacheLockTest } = await import("../lib/cache-lock")
    const root = await createTempDir("opencode-cache-lock-")
    const targetPath = path.join(root, "heartbeat-skip-target")
    const release = await __cacheLockTest.lockWithDirectoryFallback(targetPath, {
      stale: 20,
      retries: { retries: 0, minTimeout: 1, maxTimeout: 1 }
    })

    await expect(release()).resolves.toBeUndefined()
    heartbeatCallback?.()
    await Promise.resolve()
    expect(utimesSpy).not.toHaveBeenCalled()
  })

  it("reclaims stale fallback lock directories before retrying", async () => {
    vi.resetModules()
    mockUnavailableProperLockfile()

    const { __cacheLockTest } = await import("../lib/cache-lock")
    const root = await createTempDir("opencode-cache-lock-")
    const targetPath = path.join(root, "stale-target")
    const lockDir = `${targetPath}.lock`

    await fs.mkdir(lockDir)
    const staleDate = new Date(Date.now() - 5_000)
    await fs.utimes(lockDir, staleDate, staleDate)

    const release = await __cacheLockTest.lockWithDirectoryFallback(targetPath, {
      stale: 1,
      retries: { retries: 0, minTimeout: 1, maxTimeout: 1 }
    })

    await expect(fs.access(lockDir)).resolves.toBeUndefined()
    await release()
    await expect(fs.access(lockDir)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("retries fallback locking when the stale lock disappears during inspection", async () => {
    vi.resetModules()
    mockUnavailableProperLockfile()

    const actualMkdir = fs.mkdir.bind(fs)
    const root = await createTempDir("opencode-cache-lock-")
    const targetPath = path.join(root, "vanished-target")
    const mkdirSpy = vi
      .spyOn(fs, "mkdir")
      .mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EEXIST" }))
      .mockImplementationOnce(actualMkdir)
    const statSpy = vi.spyOn(fs, "stat").mockRejectedValueOnce(Object.assign(new Error("gone"), { code: "ENOENT" }))

    const { __cacheLockTest } = await import("../lib/cache-lock")

    const release = await __cacheLockTest.lockWithDirectoryFallback(targetPath, {
      stale: 1,
      retries: { retries: 1, minTimeout: 1, maxTimeout: 1 }
    })

    expect(mkdirSpy).toHaveBeenCalledTimes(2)
    expect(statSpy).toHaveBeenCalledTimes(1)
    await release()
  })

  it("does not remove a fallback lock after ownership has been replaced", async () => {
    vi.resetModules()
    mockUnavailableProperLockfile()

    const { __cacheLockTest } = await import("../lib/cache-lock")
    const root = await createTempDir("opencode-cache-lock-")
    const targetPath = path.join(root, "replaced-owner-target")
    const lockDir = `${targetPath}.lock`
    const release = await __cacheLockTest.lockWithDirectoryFallback(targetPath, {
      stale: 20,
      retries: { retries: 0, minTimeout: 1, maxTimeout: 1 }
    })

    await fs.rm(lockDir, { recursive: true, force: true })
    await fs.mkdir(lockDir)
    await __cacheLockTest.writeDirectoryLockOwner(lockDir, "other-owner")

    await expect(release()).resolves.toBeUndefined()
    await expect(fs.access(lockDir)).resolves.toBeUndefined()
  })

  it("rethrows non-ENOENT stale inspection errors", async () => {
    vi.resetModules()
    mockUnavailableProperLockfile()

    const root = await createTempDir("opencode-cache-lock-")
    const targetPath = path.join(root, "stat-error-target")
    await fs.mkdir(`${targetPath}.lock`)

    const statSpy = vi.spyOn(fs, "stat").mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "EPERM" }))

    const { __cacheLockTest } = await import("../lib/cache-lock")

    await expect(
      __cacheLockTest.lockWithDirectoryFallback(targetPath, {
        stale: 1,
        retries: { retries: 0, minTimeout: 1, maxTimeout: 1 }
      })
    ).rejects.toMatchObject({ code: "EPERM" })
    expect(statSpy).toHaveBeenCalledTimes(1)
  })

  it("does not reclaim an active fallback lock after the stale window elapses", async () => {
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
      { staleMs: 50 }
    )

    while (!firstEntered) {
      await sleep(5)
    }

    await sleep(120)

    let secondEntered = false
    const secondLock = withLockedFile(
      filePath,
      async () => {
        secondEntered = true
      },
      { staleMs: 50 }
    )

    await sleep(80)
    expect(secondEntered).toBe(false)

    releaseFirst()
    await firstLock
    await secondLock
    expect(secondEntered).toBe(true)
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
        stale: 100_000,
        retries: { retries: 0, minTimeout: 1, maxTimeout: 1 }
      })
    ).rejects.toMatchObject({ code: "EEXIST" })
  })
})
