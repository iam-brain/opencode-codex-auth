import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  PERSONALITY_SKILL_FILE,
  PERSONALITY_SKILL_KEY,
  installPersonalityBuilderSkill
} from "../lib/personality-skill"

describe("personality skill installer", () => {
  it("writes skill bundle and preserves existing files by default", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-skill-"))
    const skillsDir = path.join(root, "skills")

    const first = await installPersonalityBuilderSkill({ skillsDir })
    expect(first.created).toBe(true)
    const skillPath = path.join(skillsDir, PERSONALITY_SKILL_KEY, PERSONALITY_SKILL_FILE)
    const refPath = path.join(
      skillsDir,
      PERSONALITY_SKILL_KEY,
      "references",
      "personality-patterns.md"
    )
    const firstContent = await fs.readFile(skillPath, "utf8")
    expect(firstContent).toContain("name: personality-builder")
    expect(firstContent).toContain("create-personality")
    expect(await fs.readFile(refPath, "utf8")).toContain("Core contract")

    await fs.writeFile(skillPath, "custom skill", "utf8")
    const second = await installPersonalityBuilderSkill({ skillsDir })
    expect(second.created).toBe(false)
    expect(second.updated).toBe(false)
    expect(await fs.readFile(skillPath, "utf8")).toBe("custom skill")
  })

  it("updates existing skill files when forced", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-skill-force-"))
    const skillsDir = path.join(root, "skills")
    const skillPath = path.join(skillsDir, PERSONALITY_SKILL_KEY, PERSONALITY_SKILL_FILE)
    const refPath = path.join(
      skillsDir,
      PERSONALITY_SKILL_KEY,
      "references",
      "personality-patterns.md"
    )
    await fs.mkdir(path.dirname(skillPath), { recursive: true })
    await fs.writeFile(skillPath, "stale skill", "utf8")
    await fs.mkdir(path.dirname(refPath), { recursive: true })
    await fs.writeFile(refPath, "stale reference", "utf8")

    const result = await installPersonalityBuilderSkill({ skillsDir, force: true })
    expect(result.created).toBe(false)
    expect(result.updated).toBe(true)

    const content = await fs.readFile(skillPath, "utf8")
    expect(content).toContain("name: personality-builder")
    expect(content).toContain("create-personality")
  })
})
