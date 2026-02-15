import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export const CODEX_ORCHESTRATOR_AGENT_FILE = "orchestrator.md"
export const CODEX_ORCHESTRATOR_AGENT_FILE_DISABLED = `${CODEX_ORCHESTRATOR_AGENT_FILE}.disabled`
const PRIVATE_DIR_MODE = 0o700

async function ensurePrivateDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true, mode: PRIVATE_DIR_MODE })
  await fs.chmod(dirPath, PRIVATE_DIR_MODE).catch(() => {})
}

const CODEX_ORCHESTRATOR_AGENT_TEMPLATE = `---
description: Codex-style orchestration profile for parallel delegation and synthesis.
mode: primary
---

You are the Orchestrator agent.

Coordinate multi-step tasks by delegating independent work to subagents, then synthesize results into one coherent outcome.

# Sub-agents

If subagent tools are unavailable, continue solo and ignore subagent-specific guidance.

When subagents are available:
- Decompose into independent subtasks.
- Launch subagents in parallel when safe.
- Use wait/send-input style coordination to drive progress.
- Integrate findings and deliver a final answer.

Do not create unnecessary delegation for trivial tasks.
`

export type InstallOrchestratorAgentInput = {
  agentsDir?: string
  force?: boolean
}

export type InstallOrchestratorAgentResult = {
  agentsDir: string
  filePath: string
  created: boolean
  updated: boolean
}

export type ReconcileOrchestratorAgentVisibilityInput = {
  agentsDir?: string
  visible: boolean
  force?: boolean
}

export type ReconcileOrchestratorAgentVisibilityResult = {
  agentsDir: string
  filePath: string
  visible: boolean
  created: boolean
  updated: boolean
  moved: boolean
}

export function defaultOpencodeAgentsDir(env: Record<string, string | undefined> = process.env): string {
  const xdgRoot = env.XDG_CONFIG_HOME?.trim()
  if (xdgRoot) {
    return path.join(xdgRoot, "opencode", "agents")
  }
  return path.join(os.homedir(), ".config", "opencode", "agents")
}

async function readIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8")
  } catch {
    return undefined
  }
}

async function exists(filePath: string): Promise<boolean> {
  return (await readIfExists(filePath)) !== undefined
}

async function ensureTemplateFile(filePath: string, force: boolean): Promise<{ created: boolean; updated: boolean }> {
  const existingContent = await readIfExists(filePath)
  if (existingContent === CODEX_ORCHESTRATOR_AGENT_TEMPLATE) {
    return { created: false, updated: false }
  }
  if (existingContent !== undefined && !force) {
    return { created: false, updated: false }
  }

  await ensurePrivateDir(path.dirname(filePath))
  await fs.writeFile(filePath, CODEX_ORCHESTRATOR_AGENT_TEMPLATE, { encoding: "utf8", mode: 0o600 })

  return {
    created: existingContent === undefined,
    updated: existingContent !== undefined
  }
}

export async function installOrchestratorAgent(
  input: InstallOrchestratorAgentInput = {}
): Promise<InstallOrchestratorAgentResult> {
  const agentsDir = input.agentsDir ?? defaultOpencodeAgentsDir()
  const filePath = path.join(agentsDir, CODEX_ORCHESTRATOR_AGENT_FILE)
  const ensured = await ensureTemplateFile(filePath, input.force === true)

  return {
    agentsDir,
    filePath,
    created: ensured.created,
    updated: ensured.updated
  }
}

export async function reconcileOrchestratorAgentVisibility(
  input: ReconcileOrchestratorAgentVisibilityInput
): Promise<ReconcileOrchestratorAgentVisibilityResult> {
  const agentsDir = input.agentsDir ?? defaultOpencodeAgentsDir()
  const enabledPath = path.join(agentsDir, CODEX_ORCHESTRATOR_AGENT_FILE)
  const disabledPath = path.join(agentsDir, CODEX_ORCHESTRATOR_AGENT_FILE_DISABLED)
  const force = input.force === true
  const enabledExists = await exists(enabledPath)
  const disabledExists = await exists(disabledPath)

  if (input.visible) {
    if (enabledExists) {
      const ensured = await ensureTemplateFile(enabledPath, force)
      return {
        agentsDir,
        filePath: enabledPath,
        visible: true,
        created: ensured.created,
        updated: ensured.updated,
        moved: false
      }
    }

    if (disabledExists) {
      await ensurePrivateDir(path.dirname(enabledPath))
      await fs.rename(disabledPath, enabledPath)
      return {
        agentsDir,
        filePath: enabledPath,
        visible: true,
        created: false,
        updated: false,
        moved: true
      }
    }

    const ensured = await ensureTemplateFile(enabledPath, force)
    return {
      agentsDir,
      filePath: enabledPath,
      visible: true,
      created: ensured.created,
      updated: ensured.updated,
      moved: false
    }
  }

  if (disabledExists) {
    const ensured = await ensureTemplateFile(disabledPath, force)
    return {
      agentsDir,
      filePath: disabledPath,
      visible: false,
      created: ensured.created,
      updated: ensured.updated,
      moved: false
    }
  }

  if (enabledExists) {
    await ensurePrivateDir(path.dirname(disabledPath))
    await fs.rename(enabledPath, disabledPath)
    return {
      agentsDir,
      filePath: disabledPath,
      visible: false,
      created: false,
      updated: false,
      moved: true
    }
  }

  const ensured = await ensureTemplateFile(disabledPath, force)
  return {
    agentsDir,
    filePath: disabledPath,
    visible: false,
    created: ensured.created,
    updated: ensured.updated,
    moved: false
  }
}
