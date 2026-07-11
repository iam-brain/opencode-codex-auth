import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { removeLegacyOrchestratorArtifacts } from "../lib/legacy-orchestrator-cleanup"

describe("legacy orchestrator cleanup", () => {
  it("removes plugin-managed enabled and disabled agent files", async () => {
    const agentsDir = await fs.mkdtemp(path.join(os.tmpdir(), "legacy-orchestrator-cleanup-"))
    const managed = [path.join(agentsDir, "orchestrator.md"), path.join(agentsDir, "orchestrator.md.disabled")]
    for (const filePath of managed) {
      await fs.writeFile(
        filePath,
        "---\ndescription: Codex-style orchestration profile for parallel delegation and synthesis.\n---\n",
        "utf8"
      )
    }

    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "legacy-orchestrator-cache-cleanup-"))
    const cacheFiles = [
      path.join(cacheDir, "codex-prompts-cache.json"),
      path.join(cacheDir, "codex-prompts-cache-meta.json")
    ]
    await Promise.all(cacheFiles.map((filePath) => fs.writeFile(filePath, "{}\n", "utf8")))

    const result = await removeLegacyOrchestratorArtifacts({ agentsDir, cacheDir })

    expect(result.removed).toEqual([...managed, ...cacheFiles])
    await Promise.all([...managed, ...cacheFiles].map((filePath) => expect(fs.access(filePath)).rejects.toThrow()))
  })

  it("preserves user-authored orchestrator files", async () => {
    const agentsDir = await fs.mkdtemp(path.join(os.tmpdir(), "legacy-orchestrator-cleanup-user-"))
    const filePath = path.join(agentsDir, "orchestrator.md")
    await fs.writeFile(filePath, "---\ndescription: My orchestrator\n---\nCustom instructions\n", "utf8")

    const result = await removeLegacyOrchestratorArtifacts({ agentsDir, cacheDir: agentsDir })

    expect(result).toEqual({ removed: [], preserved: [filePath] })
    await expect(fs.readFile(filePath, "utf8")).resolves.toContain("Custom instructions")
  })
})
