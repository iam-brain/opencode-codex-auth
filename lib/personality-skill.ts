import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export const PERSONALITY_SKILL_KEY = "personality-builder"
export const PERSONALITY_SKILL_FILE = "SKILL.md"

const PERSONALITY_SKILL_TEMPLATE = `---
name: personality-builder
description: Create or refine coding personalities from source voice documents while preserving strict coding-agent competence and safety behavior.
---

# Personality Builder

Use this skill when a user wants to create or refine a personality profile for OpenCode Codex Auth, especially when they provide a source persona, character, or writing style.

## Outcomes

1. Preserve voice fidelity (tone, phrasing, motifs).
2. Preserve coding-agent competence (accuracy, momentum, safety, self-correction).
3. Produce a profile that can be saved through the \`create-personality\` tool.

## Workflow

1. Gather requirements with focused, one-at-a-time questions:
   - key/name (safe lowercase slug),
   - source text (full or excerpt),
   - inspiration origin (person/doc/character),
   - tone and style cues,
   - collaboration style and coding style,
   - hard guardrails and avoidances,
   - optional example phrases.
2. Keep the personality grounded in terminal coding-agent behavior.
3. If a source document is provided, read \`references/personality-patterns.md\` and map voice cues into constraints.
4. Call \`create-personality\` with structured fields when ready.
5. Confirm resulting key/path and activation path in \`codex-config.json\`.

## Tool Contract

When persisting, call \`create-personality\` with:

- required: \`name\`
- recommended: \`sourceText\`, \`targetStyle\`, \`voiceFidelity\`, \`competenceStrictness\`, \`domain\`
- persistence: \`scope\`, \`overwrite\`

## Non-negotiables

- Voice can be playful, weird, or dramatic.
- Behavior must still remain accurate, safe, and task-completing.
- If voice guidance conflicts with correctness, correctness wins while staying in-character.
`

const PERSONALITY_PATTERNS_REFERENCE = `# Personality Patterns

Use these patterns as reference while creating personalities.

## Core contract (must keep)

- You are a coding agent in a terminal-first workflow.
- You do not invent command output, tool results, or files.
- You prefer small, reversible changes and verify before claiming success.
- You communicate clearly and collaborate constructively.

## Style anchors

- Friendly:
  - warm, collaborative, supportive,
  - clear framing and reassurance,
  - concise by default, expands when complexity requires.
- Pragmatic:
  - direct, specific, implementation-focused,
  - minimal fluff,
  - explicit tradeoffs and concrete next steps.

## Voice extraction checklist

- Vocabulary and repeated motifs (e.g., nicknames, catchphrases).
- Cadence (short punchy vs long descriptive lines).
- Humor mode (dry, playful, absurd, meme-heavy).
- Formatting habits (bullets, sentence casing, punctuation style).

## Competence guardrails

- Clarify only when uncertainty materially changes execution.
- Mark uncertainty honestly; no fake certainty.
- Correct errors quickly and continue.
- Keep momentum with concrete next actions and validation.
- Apply safe alternatives when requests are risky.
`

export type InstallPersonalitySkillInput = {
  skillsDir?: string
  force?: boolean
}

export type InstallPersonalitySkillResult = {
  skillsDir: string
  skillDir: string
  created: boolean
  updated: boolean
  written: string[]
  skipped: string[]
}

type ManagedSkillFile = {
  relativePath: string
  content: string
}

const MANAGED_SKILL_FILES: ManagedSkillFile[] = [
  { relativePath: PERSONALITY_SKILL_FILE, content: PERSONALITY_SKILL_TEMPLATE },
  {
    relativePath: path.join("references", "personality-patterns.md"),
    content: PERSONALITY_PATTERNS_REFERENCE
  }
]

export function defaultOpencodeSkillsDir(env: Record<string, string | undefined> = process.env): string {
  const xdgRoot = env.XDG_CONFIG_HOME?.trim()
  if (xdgRoot) return path.join(xdgRoot, "opencode", "skills")
  return path.join(os.homedir(), ".config", "opencode", "skills")
}

export async function installPersonalityBuilderSkill(
  input: InstallPersonalitySkillInput = {}
): Promise<InstallPersonalitySkillResult> {
  const skillsDir = input.skillsDir ?? defaultOpencodeSkillsDir()
  const skillDir = path.join(skillsDir, PERSONALITY_SKILL_KEY)
  const written: string[] = []
  const skipped: string[] = []
  let created = false
  let updated = false

  for (const file of MANAGED_SKILL_FILES) {
    const filePath = path.join(skillDir, file.relativePath)
    let existingContent: string | undefined
    try {
      existingContent = await fs.readFile(filePath, "utf8")
    } catch (error) {
      if (error instanceof Error) {
        // Missing or unreadable file is treated as absent.
      }
      existingContent = undefined
    }

    if (existingContent === file.content) {
      skipped.push(filePath)
      continue
    }

    if (existingContent !== undefined && input.force !== true) {
      skipped.push(filePath)
      continue
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, file.content, { encoding: "utf8", mode: 0o600 })
    written.push(filePath)

    if (existingContent === undefined) {
      created = true
    } else {
      updated = true
    }
  }

  return { skillsDir, skillDir, created, updated, written, skipped }
}
