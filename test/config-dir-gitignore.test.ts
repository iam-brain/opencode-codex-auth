import { describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { ensureConfigDirGitignore } from "../lib/config-dir-gitignore"

describe("config-dir gitignore hygiene", () => {
  it("does not throw when reading .gitignore fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-gitignore-"))
    const error = Object.assign(new Error("read denied"), { code: "EACCES" })
    const readSpy = vi.spyOn(fs, "readFile").mockRejectedValue(error)

    await expect(ensureConfigDirGitignore(root)).resolves.toBeUndefined()

    readSpy.mockRestore()
  })

  it("does not throw when appending .gitignore fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-gitignore-"))
    const gitignorePath = path.join(root, ".gitignore")
    await fs.writeFile(gitignorePath, "custom-entry\n", "utf8")

    const error = Object.assign(new Error("append denied"), { code: "EACCES" })
    const appendSpy = vi.spyOn(fs, "appendFile").mockRejectedValue(error)

    await expect(ensureConfigDirGitignore(root)).resolves.toBeUndefined()

    appendSpy.mockRestore()
  })
})
