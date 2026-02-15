import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  CODEX_ORCHESTRATOR_AGENT_FILE,
  CODEX_ORCHESTRATOR_AGENT_FILE_DISABLED,
  installOrchestratorAgent,
  reconcileOrchestratorAgentVisibility
} from "../lib/orchestrator-agent"

describe("orchestrator agent installer", () => {
  it("writes orchestrator agent template and preserves existing content by default", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-orchestrator-agent-"))
    const agentsDir = path.join(root, "agents")

    const first = await installOrchestratorAgent({ agentsDir })
    expect(first.created).toBe(true)
    const filePath = path.join(agentsDir, CODEX_ORCHESTRATOR_AGENT_FILE)
    const firstContent = await fs.readFile(filePath, "utf8")
    expect(firstContent).toContain("mode: primary")
    expect(firstContent).toContain("# Sub-agents")

    await fs.writeFile(filePath, "custom orchestrator", "utf8")
    const second = await installOrchestratorAgent({ agentsDir })
    expect(second.created).toBe(false)
    expect(second.updated).toBe(false)
    expect(await fs.readFile(filePath, "utf8")).toBe("custom orchestrator")
  })

  it("updates existing orchestrator agent when forced", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-orchestrator-agent-force-"))
    const agentsDir = path.join(root, "agents")
    const filePath = path.join(agentsDir, CODEX_ORCHESTRATOR_AGENT_FILE)
    await fs.mkdir(agentsDir, { recursive: true })
    await fs.writeFile(filePath, "stale orchestrator", "utf8")

    const result = await installOrchestratorAgent({ agentsDir, force: true })
    expect(result.created).toBe(false)
    expect(result.updated).toBe(true)

    const content = await fs.readFile(filePath, "utf8")
    expect(content).toContain("mode: primary")
    expect(content).toContain("# Sub-agents")
  })

  it("toggles visibility by renaming enabled/disabled file variants", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-orchestrator-agent-toggle-"))
    const agentsDir = path.join(root, "agents")

    const hidden = await reconcileOrchestratorAgentVisibility({ agentsDir, visible: false })
    expect(hidden.visible).toBe(false)
    expect(hidden.filePath).toBe(path.join(agentsDir, CODEX_ORCHESTRATOR_AGENT_FILE_DISABLED))

    const hiddenContent = await fs.readFile(hidden.filePath, "utf8")
    expect(hiddenContent).toContain("mode: primary")

    const visible = await reconcileOrchestratorAgentVisibility({ agentsDir, visible: true })
    expect(visible.visible).toBe(true)
    expect(visible.filePath).toBe(path.join(agentsDir, CODEX_ORCHESTRATOR_AGENT_FILE))

    await expect(fs.access(path.join(agentsDir, CODEX_ORCHESTRATOR_AGENT_FILE_DISABLED))).rejects.toBeTruthy()
    expect(await fs.readFile(visible.filePath, "utf8")).toContain("# Sub-agents")
  })
})
