import { describe, expect, it } from "vitest"

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { loadAuthStorage } from "../lib/storage"

describe("storage corruption", () => {
  it("quarantines corrupt auth.json and returns empty storage", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-corrupt-"))
    const p = path.join(dir, "auth.json")
    await fs.writeFile(p, "{ bad json", { mode: 0o600 })

    const qDir = path.join(dir, "q")
    const data = await loadAuthStorage(p, { quarantineDir: qDir, now: () => 12345 })
    
    // Should return empty storage
    expect(data).toEqual({})
    
    // Should have moved the file to quarantine
    const files = await fs.readdir(qDir)
    expect(files.length).toBe(1)
    expect(files[0]).toContain("auth.json.12345.quarantine.json")
    
    // Original file should be gone (quarantineFile moves it)
    await expect(fs.stat(p)).rejects.toThrow()
  })
})
