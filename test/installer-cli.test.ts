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
    expect(capture.out.join("\n")).toContain("install-agents")
  })

  it("runs full install by default: plugin config + codex collaboration agents", async () => {
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
      expect(output).toContain("Written: 6")

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
    } finally {
      if (previousXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = previousXdg
      }
    }
  })

  it("installs agents to requested directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-installer-"))
    const agentsDir = path.join(root, "agents")
    const capture = captureIo()

    const code = await runInstallerCli(["install-agents", "--dir", agentsDir], capture.io)
    expect(code).toBe(0)
    expect(capture.out.join("\n")).toContain("Written: 6")

    const files = (await fs.readdir(agentsDir)).sort()
    expect(files).toEqual([
      "Codex Compact.md.disabled",
      "Codex Default.md.disabled",
      "Codex Execute.md.disabled",
      "Codex Orchestrator.md.disabled",
      "Codex Plan.md.disabled",
      "Codex Review.md.disabled"
    ])
  })
})
