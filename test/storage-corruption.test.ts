import { describe, expect, it } from "vitest"

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { loadAuthStorage, saveAuthStorage } from "../lib/storage"

describe("storage corruption", () => {
  it("quarantines corrupt auth.json with default runtime options", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-corrupt-default-"))
    const p = path.join(dir, "auth.json")
    await fs.writeFile(p, "{ bad json", { mode: 0o600 })

    await expect(loadAuthStorage(p)).rejects.toThrow("Corrupt auth storage JSON")

    const qDir = path.join(dir, "quarantine")
    const files = await fs.readdir(qDir)
    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/^auth\.json\.\d+\.quarantine\.json$/)
    await expect(fs.stat(p)).rejects.toThrow()
  })

  it("quarantines corrupt auth.json and throws by default", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-corrupt-"))
    const p = path.join(dir, "auth.json")
    await fs.writeFile(p, "{ bad json", { mode: 0o600 })

    const qDir = path.join(dir, "q")
    await expect(loadAuthStorage(p, { quarantineDir: qDir, now: () => 12345 })).rejects.toThrow(
      "Corrupt auth storage JSON"
    )

    // Should have moved the file to quarantine
    const files = await fs.readdir(qDir)
    expect(files.length).toBe(1)
    expect(files[0]).toContain("auth.json.12345.quarantine.json")

    // Original file should be gone (quarantineFile moves it)
    await expect(fs.stat(p)).rejects.toThrow()
  })

  it("saveAuthStorage quarantines corrupt auth.json and fails fast", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-corrupt-save-"))
    const p = path.join(dir, "auth.json")
    await fs.writeFile(p, "{ bad json", { mode: 0o600 })

    await expect(
      saveAuthStorage(p, (auth) => {
        auth.openai = {
          type: "oauth",
          accounts: []
        }
        return auth
      })
    ).rejects.toThrow("Corrupt auth storage JSON")

    const qDir = path.join(dir, "quarantine")
    const files = await fs.readdir(qDir)
    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/^auth\.json\.\d+\.quarantine\.json$/)
    await expect(fs.stat(p)).rejects.toThrow()
  })

  it("quarantines structurally invalid JSON root arrays", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-corrupt-structure-"))
    const p = path.join(dir, "auth.json")
    await fs.writeFile(p, "[]\n", { mode: 0o600 })

    await expect(loadAuthStorage(p)).rejects.toThrow("Corrupt auth storage JSON")

    const qDir = path.join(dir, "quarantine")
    const files = await fs.readdir(qDir)
    expect(files.length).toBe(1)
    await expect(fs.stat(p)).rejects.toThrow()
  })

  it("quarantines structurally invalid JSON root strings", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-corrupt-structure-"))
    const p = path.join(dir, "auth.json")
    await fs.writeFile(p, "\"oops\"\n", { mode: 0o600 })

    await expect(loadAuthStorage(p)).rejects.toThrow("Corrupt auth storage JSON")

    const qDir = path.join(dir, "quarantine")
    const files = await fs.readdir(qDir)
    expect(files.length).toBe(1)
    await expect(fs.stat(p)).rejects.toThrow()
  })
})
