import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { defaultOpencodeCachePath } from "./paths.js"

const LEGACY_AGENT_FILES = ["orchestrator.md", "orchestrator.md.disabled"] as const
const LEGACY_CACHE_FILES = ["codex-prompts-cache.json", "codex-prompts-cache-meta.json"] as const
const MANAGED_MARKER = "description: Codex-style orchestration profile for parallel delegation and synthesis."

export type LegacyOrchestratorCleanupResult = {
  removed: string[]
  preserved: string[]
}

export function defaultOpencodeAgentsDir(env: Record<string, string | undefined> = process.env): string {
  const xdgRoot = env.XDG_CONFIG_HOME?.trim()
  if (xdgRoot) return path.join(xdgRoot, "opencode", "agents")
  return path.join(os.homedir(), ".config", "opencode", "agents")
}

export async function removeLegacyOrchestratorArtifacts(
  input: { agentsDir?: string; cacheDir?: string } = {}
): Promise<LegacyOrchestratorCleanupResult> {
  const agentsDir = input.agentsDir ?? defaultOpencodeAgentsDir()
  const cacheDir = input.cacheDir ?? defaultOpencodeCachePath()
  const removed: string[] = []
  const preserved: string[] = []

  for (const fileName of LEGACY_AGENT_FILES) {
    const filePath = path.join(agentsDir, fileName)
    let content: string
    try {
      content = await fs.readFile(filePath, "utf8")
    } catch {
      continue
    }

    if (!content.includes(MANAGED_MARKER)) {
      preserved.push(filePath)
      continue
    }

    await fs.unlink(filePath)
    removed.push(filePath)
  }

  for (const fileName of LEGACY_CACHE_FILES) {
    const filePath = path.join(cacheDir, fileName)
    try {
      await fs.unlink(filePath)
      removed.push(filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }

  return { removed, preserved }
}
