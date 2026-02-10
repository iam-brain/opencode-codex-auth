import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { resolveCustomPersonalityDescription } from "../lib/personalities"

async function makeTmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

describe("custom personality resolution", () => {
  it("prefers project-local personality files", async () => {
    const root = await makeTmpDir("opencode-codex-auth-personality-local-")
    const localDir = path.join(root, ".opencode", "Personalities")
    await fs.mkdir(localDir, { recursive: true })
    await fs.writeFile(path.join(localDir, "Friendly.md"), "Local friendly tone", "utf8")

    const value = await resolveCustomPersonalityDescription("friendly", {
      projectRoot: root,
      configRoot: path.join(root, "config")
    })
    expect(value).toBe("Local friendly tone")
  })

  it("falls back to global personality files when local file is missing", async () => {
    const root = await makeTmpDir("opencode-codex-auth-personality-global-")
    const globalDir = path.join(root, "config", "Personalities")
    await fs.mkdir(globalDir, { recursive: true })
    await fs.writeFile(path.join(globalDir, "Pragmatic.md"), "Global pragmatic tone", "utf8")

    const value = await resolveCustomPersonalityDescription("pragmatic", {
      projectRoot: path.join(root, "project"),
      configRoot: path.join(root, "config")
    })
    expect(value).toBe("Global pragmatic tone")
  })

  it("rejects unsafe personality keys", async () => {
    const root = await makeTmpDir("opencode-codex-auth-personality-safe-")
    const value = await resolveCustomPersonalityDescription("../evil", {
      projectRoot: root,
      configRoot: path.join(root, "config")
    })
    expect(value).toBeNull()
  })
})
