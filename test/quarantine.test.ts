import { describe, expect, it } from "vitest"

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { quarantineFile } from "../lib/quarantine"

describe("quarantine", () => {
  it("moves corrupt file to quarantine dir and sets 0600 best-effort", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-q-"))
    const src = path.join(dir, "auth.json")
    await fs.writeFile(src, "{ not json", { mode: 0o600 })

    const result = await quarantineFile({
      sourcePath: src,
      quarantineDir: path.join(dir, "quarantine"),
      now: () => 123
    })

    expect(result.quarantinedPath).toContain("quarantine")
    expect(result.quarantinedPath).toContain("auth.json.123.quarantine.json")
    await expect(fs.stat(result.quarantinedPath)).resolves.toBeTruthy()
    await expect(fs.stat(src)).rejects.toThrow() // Source should be gone
  })

  it("enforces bounded retention (default 5)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-retention-"))
    const quarantineDir = path.join(dir, "quarantine")
    const src = path.join(dir, "auth.json")

    for (let i = 1; i <= 10; i++) {
      await fs.writeFile(src, `corrupt ${i}`)
      await quarantineFile({
        sourcePath: src,
        quarantineDir,
        now: () => 1000 + i
      })
    }

    const files = await fs.readdir(quarantineDir)
    expect(files.length).toBe(5)

    // Check that we kept the newest ones (1006 to 1010)
    files.sort()
    expect(files[0]).toContain("1006")
    expect(files[4]).toContain("1010")
  })

  it("respects custom keep limit (min 1)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-custom-keep-"))
    const quarantineDir = path.join(dir, "quarantine")
    const src = path.join(dir, "auth.json")

    for (let i = 1; i <= 3; i++) {
      await fs.writeFile(src, `corrupt ${i}`)
      await quarantineFile({
        sourcePath: src,
        quarantineDir,
        now: () => 1000 + i,
        keep: 1
      })
    }

    const files = await fs.readdir(quarantineDir)
    expect(files.length).toBe(1)
    expect(files[0]).toContain("1003")
  })

  it("retains newest entries by numeric timestamp when timestamp width differs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-retention-numeric-"))
    const quarantineDir = path.join(dir, "quarantine")
    const src = path.join(dir, "auth.json")

    await fs.writeFile(src, "corrupt old")
    await quarantineFile({
      sourcePath: src,
      quarantineDir,
      now: () => 9,
      keep: 1
    })

    await fs.writeFile(src, "corrupt new")
    await quarantineFile({
      sourcePath: src,
      quarantineDir,
      now: () => 10,
      keep: 1
    })

    const files = await fs.readdir(quarantineDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toContain("10")
  })
})
