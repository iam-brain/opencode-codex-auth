import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { parseConfigJsonWithComments } from "../lib/config"
import { runInstallerCli } from "../lib/installer-cli"

function captureIo() {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    io: {
      out: (message: string) => out.push(message),
      err: (message: string) => err.push(message)
    }
  }
}

describe("installer cli", () => {
  it("prints help", async () => {
    const capture = captureIo()
    const code = await runInstallerCli(["--help"], capture.io)
    expect(code).toBe(0)
    expect(capture.out.join("\n")).toContain("install ")
    expect(capture.out.join("\n")).not.toContain("install-agents")
  })

  it("runs full install by default: plugin config + personality workflows", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-installer-"))
    const agentsDir = path.join(root, "agents")
    const configPath = path.join(root, "opencode.json")
    const capture = captureIo()
    const previousXdg = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = root

    try {
      const code = await runInstallerCli(["--dir", agentsDir, "--config", configPath], capture.io)
      expect(code).toBe(0)
      const output = capture.out.join("\n")
      expect(output).toContain("Plugin specifier: @iam-brain/opencode-codex-auth@latest")
      expect(output).toContain("OpenCode config created: yes")
      expect(output).toContain("OpenCode config updated: yes")
      expect(output).toContain("Codex config:")
      expect(output).toContain("/create-personality synchronized: created")
      expect(output).toContain("personality-builder skill synchronized: created")
      expect(output).toContain("Codex prompts cache synchronized: yes")
      expect(output).toContain("Orchestrator agent visible in current mode (native, collaboration=off): no")

      const config = JSON.parse(await fs.readFile(configPath, "utf8")) as { plugin: string[] }
      expect(config.plugin).toContain("@iam-brain/opencode-codex-auth@latest")
      const codexConfig = parseConfigJsonWithComments(
        await fs.readFile(path.join(root, "opencode", "codex-config.json"), "utf8")
      ) as { runtime?: { mode?: string } }
      expect(codexConfig.runtime?.mode).toBe("native")

      const createPersonalityCommand = await fs.readFile(
        path.join(root, "opencode", "commands", "create-personality.md"),
        "utf8"
      )
      expect(createPersonalityCommand).toContain("create-personality")

      const skillFile = await fs.readFile(
        path.join(root, "opencode", "skills", "personality-builder", "SKILL.md"),
        "utf8"
      )
      expect(skillFile).toContain("name: personality-builder")

      await expect(fs.access(path.join(root, "opencode", "agents", "orchestrator.md"))).rejects.toBeTruthy()
      await expect(
        fs.access(path.join(root, "opencode", "agents", "orchestrator.md.disabled"))
      ).resolves.toBeUndefined()
    } finally {
      if (previousXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = previousXdg
      }
    }
  })

  it("rejects removed install-agents command", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-installer-"))
    const agentsDir = path.join(root, "agents")
    const capture = captureIo()

    const code = await runInstallerCli(["install-agents", "--dir", agentsDir], capture.io)
    expect(code).toBe(1)
    expect(capture.err.join("\n")).toContain("Unknown command: install-agents")
  })

  it("shows orchestrator agent in codex mode", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-installer-codex-"))
    const configPath = path.join(root, "opencode.json")
    const capture = captureIo()
    const previousXdg = process.env.XDG_CONFIG_HOME
    const previousMode = process.env.OPENCODE_OPENAI_MULTI_MODE
    process.env.XDG_CONFIG_HOME = root
    process.env.OPENCODE_OPENAI_MULTI_MODE = "codex"

    try {
      const code = await runInstallerCli(["--config", configPath], capture.io)
      expect(code).toBe(0)
      expect(capture.out.join("\n")).toContain(
        "Orchestrator agent visible in current mode (codex, collaboration=on): yes"
      )
      expect(capture.out.join("\n")).toContain("Codex prompts cache synchronized: yes")
      await expect(fs.access(path.join(root, "opencode", "agents", "orchestrator.md"))).resolves.toBeUndefined()
      await expect(fs.access(path.join(root, "opencode", "agents", "orchestrator.md.disabled"))).rejects.toBeTruthy()
    } finally {
      if (previousXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = previousXdg
      }

      if (previousMode === undefined) {
        delete process.env.OPENCODE_OPENAI_MULTI_MODE
      } else {
        process.env.OPENCODE_OPENAI_MULTI_MODE = previousMode
      }
    }
  })
})
