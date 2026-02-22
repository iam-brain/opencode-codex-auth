import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  readJsonFileBestEffort,
  setCacheIoFailureObserver,
  writeJsonFileAtomic,
  writeJsonFileAtomicBestEffort,
  writeJsonFileBestEffort
} from "../lib/cache-io"

describe("cache-io failure observer", () => {
  afterEach(() => {
    setCacheIoFailureObserver(undefined)
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

  it("ignores EPERM during fsync for atomic writes on win32", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")
    Object.defineProperty(process, "platform", { value: "win32", configurable: true })

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cache-io-test-"))
    const filePath = path.join(root, "auth.json")
    const openActual = fs.open.bind(fs)
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await openActual(...args)

      return new Proxy(handle, {
        get(targetHandle, prop, receiver) {
          if (prop === "sync") {
            return async () => {
              const error = new Error("operation not permitted") as NodeJS.ErrnoException
              error.code = "EPERM"
              throw error
            }
          }
          return Reflect.get(targetHandle, prop, receiver)
        }
      }) as Awaited<ReturnType<typeof fs.open>>
    })

    try {
      await expect(writeJsonFileAtomic(filePath, { ok: true })).resolves.toBeUndefined()
    } finally {
      openSpy.mockRestore()
      if (originalPlatform) {
        Object.defineProperty(process, "platform", originalPlatform)
      }
    }

    const persisted = JSON.parse(await fs.readFile(filePath, "utf8")) as { ok?: boolean }
    expect(persisted.ok).toBe(true)
  })

  it("propagates non-whitelisted sync errors like EIO", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")
    Object.defineProperty(process, "platform", { value: "win32", configurable: true })

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-cache-io-test-"))
    const filePath = path.join(root, "auth.json")
    const openActual = fs.open.bind(fs)
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      const handle = await openActual(...args)

      return new Proxy(handle, {
        get(targetHandle, prop, receiver) {
          if (prop === "sync") {
            return async () => {
              const error = new Error("input/output error") as NodeJS.ErrnoException
              error.code = "EIO"
              throw error
            }
          }
          return Reflect.get(targetHandle, prop, receiver)
        }
      }) as Awaited<ReturnType<typeof fs.open>>
    })

    try {
      await expect(writeJsonFileAtomic(filePath, { ok: true })).rejects.toThrow("input/output error")
    } finally {
      openSpy.mockRestore()
      if (originalPlatform) {
        Object.defineProperty(process, "platform", originalPlatform)
      }
    }
  })
})
