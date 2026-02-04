import { describe, expect, it } from "vitest"

import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { defaultAuthPath } from "../lib/paths"
import { loadAuthStorage, saveAuthStorage } from "../lib/storage"

function fixturePath(name: string): string {
  return new URL(`./fixtures/${name}`, import.meta.url).pathname
}

describe("auth storage", () => {
  it("defaultAuthPath points at ~/.config/opencode/auth.json", () => {
    expect(defaultAuthPath()).toBe(
      path.join(os.homedir(), ".config", "opencode", "auth.json")
    )
  })

  it("loadAuthStorage creates parent dir and returns {} when missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-auth-"))
    const filePath = path.join(dir, "nested", "auth.json")

    const auth = await loadAuthStorage(filePath)

    expect(auth).toEqual({})
    await expect(stat(path.dirname(filePath))).resolves.toBeDefined()
  })

  it("migrates single-account openai oauth to multi-account schema", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-auth-"))
    const filePath = path.join(dir, "auth.json")
    const singleJson = await readFile(fixturePath("auth-single.json"), "utf8")
    await writeFile(filePath, singleJson, { mode: 0o600 })

    const auth = await loadAuthStorage(filePath)

    expect(auth.openai?.type).toBe("oauth")
    const openai: any = auth.openai
    expect(Array.isArray(openai?.accounts)).toBe(true)
    expect(openai.accounts).toHaveLength(1)
    const account = openai.accounts[0]
    expect(account.enabled).toBe(true)
    expect(account.identityKey).toBe("acc_123|user@example.com|plus")
    expect(openai.activeIdentityKey).toBe(account.identityKey)
  })

  it("saveAuthStorage writes atomically and enforces 0600 permissions", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-auth-"))
    const filePath = path.join(dir, "auth.json")
    await mkdir(path.dirname(filePath), { recursive: true })

    const multiJson = await readFile(fixturePath("auth-multi.json"), "utf8")
    const expected = JSON.parse(multiJson)

    await saveAuthStorage(filePath, (auth) => {
      auth.openai = expected.openai
      return auth
    })

    const onDisk = JSON.parse(await readFile(filePath, "utf8"))
    expect(onDisk).toEqual(expected)

    const mode = (await stat(filePath)).mode & 0o777
    expect(mode).toBe(0o600)

    await expect(stat(`${filePath}.tmp`)).rejects.toBeDefined()
  })

  it("saveAuthStorage migrates before applying update", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-auth-"))
    const filePath = path.join(dir, "auth.json")
    const singleJson = await readFile(fixturePath("auth-single.json"), "utf8")
    await writeFile(filePath, singleJson, { mode: 0o600 })

    await saveAuthStorage(filePath, (auth) => {
      const openai = auth.openai as any
      expect(openai?.accounts?.length).toBe(1)
      openai.strategy = "round_robin"
      return auth
    })

    const onDisk = JSON.parse(await readFile(filePath, "utf8"))
    expect(onDisk.openai.type).toBe("oauth")
    expect(onDisk.openai.strategy).toBe("round_robin")
    expect(onDisk.openai.accounts).toHaveLength(1)
  })
})
