import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  __testOnly,
  enforceOwnerOnlyPermissions,
  readJsonFileBestEffort,
  setCacheIoFailureObserver,
  writeJsonFileAtomic,
  writeJsonFileAtomicBestEffort,
  writeJsonFileBestEffort
} from "../lib/cache-io.js"

describe("cache-io failure observer", () => {
  afterEach(() => {
    setCacheIoFailureObserver(undefined)
    __testOnly.setPlatformResolver(undefined)
  })

  it("notifies observer on malformed JSON reads", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cache-io-test-"))
    const filePath = path.join(root, "bad.json")
    await fs.writeFile(filePath, "{", "utf8")

    let observed: { operation: string; filePath: string; error: unknown } | undefined
    setCacheIoFailureObserver((event) => {
      observed = event
    })

    const value = await readJsonFileBestEffort(filePath)
    expect(value).toBeUndefined()
    expect(observed?.operation).toBe("readJsonFileBestEffort")
    expect(observed?.filePath).toBe(filePath)
  })

  it("does not notify observer for missing files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cache-io-test-"))
    const filePath = path.join(root, "missing.json")

    let observed: { operation: string; filePath: string; error: unknown } | undefined
    setCacheIoFailureObserver((event) => {
      observed = event
    })

    const value = await readJsonFileBestEffort(filePath)
    expect(value).toBeUndefined()
    expect(observed).toBeUndefined()
  })

  it("notifies observer on write failures", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cache-io-test-"))
    const parentAsFile = path.join(root, "parent-file")
    await fs.writeFile(parentAsFile, "x", "utf8")

    let observed: { operation: string; filePath: string; error: unknown } | undefined
    setCacheIoFailureObserver((event) => {
      observed = event
    })

    const badPath = path.join(parentAsFile, "forbidden.json")
    await writeJsonFileBestEffort(badPath, { ok: true })

    expect(observed?.operation).toBe("writeJsonFileBestEffort")
    expect(observed?.filePath).toBe(badPath)
  })

  it("notifies observer on atomic write failures", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cache-io-test-"))
    const parentAsFile = path.join(root, "parent-file")
    await fs.writeFile(parentAsFile, "x", "utf8")

    let observed: { operation: string; filePath: string; error: unknown } | undefined
    setCacheIoFailureObserver((event) => {
      observed = event
    })

    const badPath = path.join(parentAsFile, "forbidden-atomic.json")
    await writeJsonFileAtomicBestEffort(badPath, { ok: true })

    expect(observed?.operation).toBe("writeJsonFileAtomicBestEffort")
    expect(observed?.filePath).toBe(badPath)
  })

  it("swallows observer failures", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cache-io-test-"))
    const filePath = path.join(root, "bad.json")
    await fs.writeFile(filePath, "{", "utf8")

    setCacheIoFailureObserver(() => {
      throw new Error("observer failed")
    })

    await expect(readJsonFileBestEffort(filePath)).resolves.toBeUndefined()
  })

  it("tolerates unsupported chmod errors when enforcing owner-only mode", async () => {
    const chmodSpy = vi.spyOn(fs, "chmod").mockImplementation(async () => {
      const error = new Error("operation not supported") as NodeJS.ErrnoException
      error.code = "ENOTSUP"
      throw error
    })

    try {
      await expect(enforceOwnerOnlyPermissions("/tmp/noop")).resolves.toBeUndefined()
    } finally {
      chmodSpy.mockRestore()
    }
  })

  it("propagates unexpected chmod errors when enforcing owner-only mode", async () => {
    const chmodSpy = vi.spyOn(fs, "chmod").mockImplementation(async () => {
      const error = new Error("io failure") as NodeJS.ErrnoException
      error.code = "EIO"
      throw error
    })

    try {
      await expect(enforceOwnerOnlyPermissions("/tmp/noop")).rejects.toMatchObject({ code: "EIO" })
    } finally {
      chmodSpy.mockRestore()
    }
  })

  it("does not swallow win32 temp-file sync EPERM errors", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cache-io-test-"))
    const filePath = path.join(root, "atomic.json")
    __testOnly.setPlatformResolver(() => "win32")

    const openActual = fs.open.bind(fs)
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await openActual(...args)
      return new Proxy(handle, {
        get(target, prop, receiver) {
          if (prop === "sync") {
            return async () => {
              const error = new Error("operation not permitted") as NodeJS.ErrnoException
              error.code = "EPERM"
              throw error
            }
          }
          return Reflect.get(target, prop, receiver)
        }
      })
    })

    try {
      await expect(writeJsonFileAtomic(filePath, { ok: true })).rejects.toMatchObject({ code: "EPERM" })
    } finally {
      openSpy.mockRestore()
      __testOnly.setPlatformResolver(undefined)
    }
  })

  it("uses write-capable open mode for temp-file sync", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cache-io-test-"))
    const filePath = path.join(root, "atomic.json")

    const openActual = fs.open.bind(fs)
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const [targetPath, flags] = args
      if (String(targetPath).includes(".tmp.") && String(flags) !== "r+") {
        throw new Error(`expected temp file open mode r+, got ${String(flags)}`)
      }
      return openActual(...args)
    })

    try {
      await expect(writeJsonFileAtomic(filePath, { ok: true })).resolves.toBeUndefined()
    } finally {
      openSpy.mockRestore()
    }
  })

  it("does not swallow win32 temp-file sync EINVAL errors", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cache-io-test-"))
    const filePath = path.join(root, "atomic.json")
    __testOnly.setPlatformResolver(() => "win32")

    const openActual = fs.open.bind(fs)
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await openActual(...args)
      return new Proxy(handle, {
        get(target, prop, receiver) {
          if (prop === "sync") {
            return async () => {
              const error = new Error("invalid argument") as NodeJS.ErrnoException
              error.code = "EINVAL"
              throw error
            }
          }
          return Reflect.get(target, prop, receiver)
        }
      })
    })

    try {
      await expect(writeJsonFileAtomic(filePath, { ok: true })).rejects.toMatchObject({ code: "EINVAL" })
    } finally {
      openSpy.mockRestore()
      __testOnly.setPlatformResolver(undefined)
    }
  })

  it("propagates directory close errors on non-win32", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cache-io-test-"))
    const filePath = path.join(root, "atomic.json")
    __testOnly.setPlatformResolver(() => "darwin")

    const openActual = fs.open.bind(fs)
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const [targetPath] = args
      const handle = await openActual(...args)
      if (String(targetPath) !== root) {
        return handle
      }
      return new Proxy(handle, {
        get(target, prop, receiver) {
          if (prop === "close") {
            return async () => {
              const error = new Error("directory close failed") as NodeJS.ErrnoException
              error.code = "EINVAL"
              throw error
            }
          }
          return Reflect.get(target, prop, receiver)
        }
      })
    })

    try {
      await expect(writeJsonFileAtomic(filePath, { ok: true })).rejects.toMatchObject({ code: "EINVAL" })
    } finally {
      openSpy.mockRestore()
      __testOnly.setPlatformResolver(undefined)
    }
  })

  it("does not swallow non-whitelisted sync errors", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cache-io-test-"))
    const filePath = path.join(root, "atomic.json")

    const openActual = fs.open.bind(fs)
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await openActual(...args)
      return new Proxy(handle, {
        get(target, prop, receiver) {
          if (prop === "sync") {
            return async () => {
              const error = new Error("disk io failure") as NodeJS.ErrnoException
              error.code = "EIO"
              throw error
            }
          }
          return Reflect.get(target, prop, receiver)
        }
      })
    })

    try {
      await expect(writeJsonFileAtomic(filePath, { ok: true })).rejects.toMatchObject({ code: "EIO" })
    } finally {
      openSpy.mockRestore()
    }
  })

  it("propagates directory sync open errors on non-win32", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cache-io-test-"))
    const filePath = path.join(root, "atomic.json")
    __testOnly.setPlatformResolver(() => "darwin")

    const openActual = fs.open.bind(fs)
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const [targetPath] = args
      if (String(targetPath) === root) {
        const error = new Error("invalid directory handle") as NodeJS.ErrnoException
        error.code = "EINVAL"
        throw error
      }
      return openActual(...args)
    })

    try {
      await expect(writeJsonFileAtomic(filePath, { ok: true })).rejects.toMatchObject({ code: "EINVAL" })
    } finally {
      openSpy.mockRestore()
      __testOnly.setPlatformResolver(undefined)
    }
  })

  it("tolerates directory sync open EPERM on win32", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cache-io-test-"))
    const filePath = path.join(root, "atomic.json")
    __testOnly.setPlatformResolver(() => "win32")

    const openActual = fs.open.bind(fs)
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const [targetPath] = args
      if (String(targetPath) === root) {
        const error = new Error("operation not permitted") as NodeJS.ErrnoException
        error.code = "EPERM"
        throw error
      }
      return openActual(...args)
    })

    try {
      await expect(writeJsonFileAtomic(filePath, { ok: true })).resolves.toBeUndefined()
    } finally {
      openSpy.mockRestore()
      __testOnly.setPlatformResolver(undefined)
    }

    const persisted = JSON.parse(await fs.readFile(filePath, "utf8")) as { ok?: boolean }
    expect(persisted.ok).toBe(true)
  })

  it("tolerates directory close EPERM on win32", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cache-io-test-"))
    const filePath = path.join(root, "atomic.json")
    __testOnly.setPlatformResolver(() => "win32")

    const openActual = fs.open.bind(fs)
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const [targetPath] = args
      const handle = await openActual(...args)
      if (String(targetPath) !== root) {
        return handle
      }
      return new Proxy(handle, {
        get(target, prop, receiver) {
          if (prop === "close") {
            return async () => {
              const error = new Error("operation not permitted") as NodeJS.ErrnoException
              error.code = "EPERM"
              throw error
            }
          }
          return Reflect.get(target, prop, receiver)
        }
      })
    })

    try {
      await expect(writeJsonFileAtomic(filePath, { ok: true })).resolves.toBeUndefined()
    } finally {
      openSpy.mockRestore()
      __testOnly.setPlatformResolver(undefined)
    }

    const persisted = JSON.parse(await fs.readFile(filePath, "utf8")) as { ok?: boolean }
    expect(persisted.ok).toBe(true)
  })
})
