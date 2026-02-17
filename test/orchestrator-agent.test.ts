import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  CODEX_ORCHESTRATOR_AGENT_FILE,
  CODEX_ORCHESTRATOR_AGENT_FILE_DISABLED,
  installOrchestratorAgent,
  reconcileOrchestratorAgentVisibility
} from "../lib/orchestrator-agent"
import { CODEX_PROMPTS_CACHE_FILE, CODEX_PROMPTS_CACHE_META_FILE } from "../lib/codex-prompts-cache"

describe("orchestrator agent installer", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("downloads upstream orchestrator prompt and prepends local frontmatter header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            "You are Codex, a coding agent based on GPT-5.\n\n# Sub-agents\nIf `spawn_agent` is unavailable or fails, ignore this section and proceed solo.",
            {
              status: 200,
              headers: { "content-type": "text/plain" }
            }
          )
      )
    )

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-orchestrator-agent-upstream-"))
    const agentsDir = path.join(root, "agents")
    const cacheDir = path.join(root, "cache")

    const first = await installOrchestratorAgent({ agentsDir, cacheDir })
    expect(first.created).toBe(true)
    const filePath = path.join(agentsDir, CODEX_ORCHESTRATOR_AGENT_FILE)
    const firstContent = await fs.readFile(filePath, "utf8")
    expect(firstContent).toContain(
      "description: Codex-style orchestration profile for parallel delegation and synthesis."
    )
    expect(firstContent).toContain("mode: primary")
    expect(firstContent).toContain("You are Codex, a coding agent based on GPT-5.")
    expect(firstContent).toContain("If `spawn_agent` is unavailable or fails, ignore this section and proceed solo.")

    const cacheRaw = await fs.readFile(path.join(cacheDir, CODEX_PROMPTS_CACHE_FILE), "utf8")
    const cache = JSON.parse(cacheRaw) as {
      prompts?: { orchestrator?: string; plan?: string }
    }
    expect(cache.prompts?.orchestrator).toContain("You are Codex, a coding agent based on GPT-5.")

    const metaRaw = await fs.readFile(path.join(cacheDir, CODEX_PROMPTS_CACHE_META_FILE), "utf8")
    const meta = JSON.parse(metaRaw) as { urls?: { orchestrator?: string; plan?: string } }
    expect(meta.urls?.orchestrator).toContain("templates/agents/orchestrator.md")
    expect(meta.urls?.plan).toContain("templates/collaboration_mode/plan.md")
  })

  it("writes orchestrator agent template and preserves existing content by default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("You are Codex, a coding agent based on GPT-5.\n\n# Sub-agents", {
            status: 200,
            headers: { "content-type": "text/plain" }
          })
      )
    )

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-orchestrator-agent-"))
    const agentsDir = path.join(root, "agents")

    const first = await installOrchestratorAgent({ agentsDir, cacheDir: path.join(root, "cache") })
    expect(first.created).toBe(true)
    const filePath = path.join(agentsDir, CODEX_ORCHESTRATOR_AGENT_FILE)
    const firstContent = await fs.readFile(filePath, "utf8")
    expect(firstContent).toContain("mode: primary")
    expect(firstContent).toContain("You are Codex, a coding agent based on GPT-5.")

    await fs.writeFile(filePath, "custom orchestrator", "utf8")
    const second = await installOrchestratorAgent({ agentsDir, cacheDir: path.join(root, "cache") })
    expect(second.created).toBe(false)
    expect(second.updated).toBe(false)
    expect(await fs.readFile(filePath, "utf8")).toBe("custom orchestrator")
  })

  it("updates existing orchestrator agent when forced", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("You are Codex, a coding agent based on GPT-5.\n\n# Sub-agents", {
            status: 200,
            headers: { "content-type": "text/plain" }
          })
      )
    )

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-orchestrator-agent-force-"))
    const agentsDir = path.join(root, "agents")
    const filePath = path.join(agentsDir, CODEX_ORCHESTRATOR_AGENT_FILE)
    await fs.mkdir(agentsDir, { recursive: true })
    await fs.writeFile(filePath, "stale orchestrator", "utf8")

    const result = await installOrchestratorAgent({ agentsDir, cacheDir: path.join(root, "cache"), force: true })
    expect(result.created).toBe(false)
    expect(result.updated).toBe(true)

    const content = await fs.readFile(filePath, "utf8")
    expect(content).toContain("mode: primary")
    expect(content).toContain("You are Codex, a coding agent based on GPT-5.")
  })

  it("toggles visibility by renaming enabled/disabled file variants", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("You are Codex, a coding agent based on GPT-5.\n\n# Sub-agents", {
            status: 200,
            headers: { "content-type": "text/plain" }
          })
      )
    )

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-orchestrator-agent-toggle-"))
    const agentsDir = path.join(root, "agents")

    const hidden = await reconcileOrchestratorAgentVisibility({
      agentsDir,
      cacheDir: path.join(root, "cache"),
      visible: false
    })
    expect(hidden.visible).toBe(false)
    expect(hidden.filePath).toBe(path.join(agentsDir, CODEX_ORCHESTRATOR_AGENT_FILE_DISABLED))

    const hiddenContent = await fs.readFile(hidden.filePath, "utf8")
    expect(hiddenContent).toContain("mode: primary")

    const visible = await reconcileOrchestratorAgentVisibility({
      agentsDir,
      cacheDir: path.join(root, "cache"),
      visible: true
    })
    expect(visible.visible).toBe(true)
    expect(visible.filePath).toBe(path.join(agentsDir, CODEX_ORCHESTRATOR_AGENT_FILE))

    await expect(fs.access(path.join(agentsDir, CODEX_ORCHESTRATOR_AGENT_FILE_DISABLED))).rejects.toBeTruthy()
    expect(await fs.readFile(visible.filePath, "utf8")).toContain("You are Codex, a coding agent based on GPT-5.")
  })

  it("applies force refresh while moving disabled->enabled and enabled->disabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("You are Codex, a coding agent based on GPT-5.\n\n# Sub-agents\nupstream", {
            status: 200,
            headers: { "content-type": "text/plain" }
          })
      )
    )

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-orchestrator-agent-force-toggle-"))
    const agentsDir = path.join(root, "agents")
    const cacheDir = path.join(root, "cache")
    const enabledPath = path.join(agentsDir, CODEX_ORCHESTRATOR_AGENT_FILE)
    const disabledPath = path.join(agentsDir, CODEX_ORCHESTRATOR_AGENT_FILE_DISABLED)

    await fs.mkdir(agentsDir, { recursive: true })
    await fs.writeFile(disabledPath, "stale disabled", "utf8")
    const visible = await reconcileOrchestratorAgentVisibility({ agentsDir, cacheDir, visible: true, force: true })
    expect(visible.moved).toBe(true)
    expect(await fs.readFile(enabledPath, "utf8")).toContain("You are Codex, a coding agent based on GPT-5.")

    await fs.writeFile(enabledPath, "stale enabled", "utf8")
    const hidden = await reconcileOrchestratorAgentVisibility({ agentsDir, cacheDir, visible: false, force: true })
    expect(hidden.moved).toBe(true)
    expect(await fs.readFile(disabledPath, "utf8")).toContain("You are Codex, a coding agent based on GPT-5.")
  })

  it("falls back to bundled full orchestrator prompt when upstream fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unavailable")
      })
    )

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-orchestrator-agent-fallback-"))
    const agentsDir = path.join(root, "agents")

    const first = await installOrchestratorAgent({ agentsDir, cacheDir: path.join(root, "cache") })
    expect(first.created).toBe(true)
    const filePath = path.join(agentsDir, CODEX_ORCHESTRATOR_AGENT_FILE)
    const firstContent = await fs.readFile(filePath, "utf8")
    expect(firstContent).toContain(
      "description: Codex-style orchestration profile for parallel delegation and synthesis."
    )
    expect(firstContent).toContain("You are Codex, a coding agent based on GPT-5.")
    expect(firstContent).toContain("If `spawn_agent` is unavailable or fails, ignore this section and proceed solo.")
  })
})
