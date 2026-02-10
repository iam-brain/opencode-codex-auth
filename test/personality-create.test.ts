import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { createPersonalityFile, renderPersonalityMarkdown } from "../lib/personality-create"

describe("personality creation", () => {
  it("creates a global personality file in lowercase personalities dir", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-create-personality-"))
    const result = await createPersonalityFile({
      name: "Architect",
      scope: "global",
      configRoot: root,
      tone: "Clear, direct, and structured.",
      constraints: "Never skip validation."
    })

    expect(result.created).toBe(true)
    expect(result.key).toBe("architect")
    expect(result.filePath).toBe(path.join(root, "personalities", "architect.md"))
    const content = await fs.readFile(result.filePath, "utf8")
    expect(content).toContain("## Core Assistant Contract")
    expect(content).toContain("terminal-first workflow")
    expect(content).toContain("Never skip validation.")
  })

  it("does not overwrite existing personality unless overwrite=true", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-create-personality-"))
    const filePath = path.join(root, "personalities", "pirate.md")
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, "existing personality", "utf8")

    const kept = await createPersonalityFile({
      name: "pirate",
      scope: "global",
      configRoot: root,
      tone: "new tone"
    })
    expect(kept.created).toBe(false)
    expect(await fs.readFile(filePath, "utf8")).toBe("existing personality")

    const replaced = await createPersonalityFile({
      name: "pirate",
      scope: "global",
      configRoot: root,
      tone: "new tone",
      overwrite: true
    })
    expect(replaced.created).toBe(false)
    expect(await fs.readFile(filePath, "utf8")).toContain("new tone")
  })

  it("renders all optional sections when provided", () => {
    const rendered = renderPersonalityMarkdown({
      key: "mentor",
      inspiration: "Derived from team onboarding docs.",
      tone: "Warm and practical.",
      collaborationStyle: "Pair and checkpoint frequently.",
      codeStyle: "Prefer small reversible diffs.",
      constraints: "Never claim unverified test passes.",
      examples: "Let's walk this in two steps."
    })
    expect(rendered).toContain("## Inspiration")
    expect(rendered).toContain("## Tone")
    expect(rendered).toContain("## Collaboration Style")
    expect(rendered).toContain("## Coding Style")
    expect(rendered).toContain("## Guardrails")
    expect(rendered).toContain("## Examples")
  })
})
