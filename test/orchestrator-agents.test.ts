import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  defaultOpencodeAgentsDir,
  getOrchestratorAgentTemplates,
  installOrchestratorAgents,
  reconcileOrchestratorAgentsState
} from "../lib/orchestrator-agents"

describe("orchestrator agents installer", () => {
  it("builds local templates including codex compact helper", () => {
    const templates = getOrchestratorAgentTemplates()
    const byFile = Object.fromEntries(templates.map((template) => [template.fileName, template.content]))

    expect(Object.keys(byFile)).toEqual([
      "Codex Orchestrator.md",
      "Codex Default.md",
      "Codex Plan.md",
      "Codex Execute.md",
      "Codex Review.md",
      "Codex Compact.md"
    ])
    expect(byFile["Codex Orchestrator.md"]).toContain("OpenCode tool compatibility")
    expect(byFile["Codex Plan.md"]).toContain("# Plan Mode")
    expect(byFile["Codex Execute.md"]).toContain("# Collaboration Style: Execute")
    expect(byFile["Codex Compact.md"]).toContain("CONTEXT CHECKPOINT COMPACTION")
  })

  it("installs templates idempotently unless force is enabled", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-openai-multi-agents-"))
    const agentsDir = path.join(root, "agents")

    const first = await installOrchestratorAgents({ agentsDir })
    expect(first.written).toHaveLength(6)
    expect(first.skipped).toHaveLength(0)

    const second = await installOrchestratorAgents({ agentsDir })
    expect(second.written).toHaveLength(0)
    expect(second.skipped).toHaveLength(6)

    const forced = await installOrchestratorAgents({ agentsDir, force: true })
    expect(forced.written).toHaveLength(6)
  })

  it("uses XDG config root when present", () => {
    const dir = defaultOpencodeAgentsDir({ XDG_CONFIG_HOME: "/tmp/xdg-root" })
    expect(dir).toBe(path.join("/tmp/xdg-root", "opencode", "agents"))
  })

  it("toggles collab agents with .md.disabled when mode changes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-openai-multi-agents-toggle-"))
    const agentsDir = path.join(root, "agents")

    await installOrchestratorAgents({ agentsDir })

    const disabled = await reconcileOrchestratorAgentsState({ agentsDir, enabled: false })
    expect(disabled.renamed).toHaveLength(0)

    const filesAfterDisable = (await fs.readdir(agentsDir)).sort()
    expect(filesAfterDisable).toEqual([
      "Codex Compact.md.disabled",
      "Codex Default.md.disabled",
      "Codex Execute.md.disabled",
      "Codex Orchestrator.md.disabled",
      "Codex Plan.md.disabled",
      "Codex Review.md.disabled"
    ])

    const enabled = await reconcileOrchestratorAgentsState({ agentsDir, enabled: true })
    expect(enabled.renamed).toHaveLength(6)

    const filesAfterEnable = (await fs.readdir(agentsDir)).sort()
    expect(filesAfterEnable).toEqual([
      "Codex Compact.md",
      "Codex Default.md",
      "Codex Execute.md",
      "Codex Orchestrator.md",
      "Codex Plan.md",
      "Codex Review.md"
    ])

    const disabledAgain = await reconcileOrchestratorAgentsState({ agentsDir, enabled: false })
    expect(disabledAgain.renamed).toHaveLength(6)

    const filesAfterDisableAgain = (await fs.readdir(agentsDir)).sort()
    expect(filesAfterDisableAgain).toEqual([
      "Codex Compact.md.disabled",
      "Codex Default.md.disabled",
      "Codex Execute.md.disabled",
      "Codex Orchestrator.md.disabled",
      "Codex Plan.md.disabled",
      "Codex Review.md.disabled"
    ])
  })
})
