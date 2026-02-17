import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  readJsonFileBestEffort,
  setCacheIoFailureObserver,
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
})
