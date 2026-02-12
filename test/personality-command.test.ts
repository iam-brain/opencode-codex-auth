import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { CREATE_PERSONALITY_COMMAND_FILE, installCreatePersonalityCommand } from "../lib/personality-command"

describe("create-personality command installer", () => {
  it("writes command template and preserves existing files by default", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-command-"))
    const commandsDir = path.join(root, "commands")

    const first = await installCreatePersonalityCommand({ commandsDir })
    expect(first.created).toBe(true)
    const filePath = path.join(commandsDir, CREATE_PERSONALITY_COMMAND_FILE)
    const firstContent = await fs.readFile(filePath, "utf8")
    expect(firstContent).toContain("create-personality")
    expect(firstContent).toContain("$ARGUMENTS")

    await fs.writeFile(filePath, "custom content", "utf8")
    const second = await installCreatePersonalityCommand({ commandsDir })
    expect(second.created).toBe(false)
    expect(second.updated).toBe(false)
    expect(await fs.readFile(filePath, "utf8")).toBe("custom content")
  })

  it("updates existing command when forced", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-command-force-"))
    const commandsDir = path.join(root, "commands")
    const filePath = path.join(commandsDir, CREATE_PERSONALITY_COMMAND_FILE)
    await fs.mkdir(commandsDir, { recursive: true })
    await fs.writeFile(filePath, "stale command", "utf8")

    const result = await installCreatePersonalityCommand({ commandsDir, force: true })
    expect(result.created).toBe(false)
    expect(result.updated).toBe(true)

    const content = await fs.readFile(filePath, "utf8")
    expect(content).toContain("create-personality")
    expect(content).toContain("$ARGUMENTS")
  })
})
