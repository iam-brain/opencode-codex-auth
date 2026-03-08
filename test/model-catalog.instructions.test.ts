import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { resolveInstructionsForModel } from "../lib/model-catalog"

async function makeCacheDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-model-catalog-"))
}

describe("model catalog instruction rendering", () => {
  it("renders personality in model instructions template", async () => {
    const root = await makeCacheDir()
    const prevCwd = process.cwd()
    const prevXdg = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = path.join(root, "xdg-empty")
    process.chdir(root)
    try {
      const instructions = resolveInstructionsForModel(
        {
          slug: "gpt-5.4-codex",
          model_messages: {
            instructions_template: "Base {{ personality }}",
            instructions_variables: {
              personality_friendly: "Friendly"
            }
          }
        },
        "friendly"
      )

      expect(instructions).toBe("Base Friendly")
    } finally {
      process.chdir(prevCwd)
      if (prevXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = prevXdg
      }
    }
  })

  it("prefers model template over base instructions when both exist", () => {
    const instructions = resolveInstructionsForModel({
      slug: "gpt-5.4-codex",
      base_instructions: "Use base instructions first",
      model_messages: {
        instructions_template: "Template {{ personality }}",
        instructions_variables: {
          personality_default: "Default"
        }
      }
    })

    expect(instructions).toBe("Template Default")
  })

  it("does not use local personality text when base and template are missing", async () => {
    const root = await makeCacheDir()
    const personalityDir = path.join(root, ".opencode", "personalities")
    await fs.mkdir(personalityDir, { recursive: true })
    await fs.writeFile(path.join(personalityDir, "Operator.md"), "Local cached instruction body", "utf8")

    const prev = process.cwd()
    process.chdir(root)
    try {
      const instructions = resolveInstructionsForModel({ slug: "gpt-5.4-codex" }, "operator")
      expect(instructions).toBeUndefined()
    } finally {
      process.chdir(prev)
    }
  })

  it("falls back to base instructions when template leaves unresolved markers", () => {
    const instructions = resolveInstructionsForModel({
      slug: "gpt-5.4-codex",
      base_instructions: "Safe base instructions",
      model_messages: {
        instructions_template: "Base {{ personality }} {{ unsupported_marker }}"
      }
    })

    expect(instructions).toBe("Safe base instructions")
  })

  it("falls back to base instructions when template includes stale bridge tool markers", () => {
    const instructions = resolveInstructionsForModel({
      slug: "gpt-5.4-codex",
      base_instructions: "Safe base instructions",
      model_messages: {
        instructions_template: "Use multi_tool_use.parallel with recipient_name=functions.read and function calls"
      }
    })

    expect(instructions).toBe("Safe base instructions")
  })

  it("renders custom personality content from local file", async () => {
    const root = await makeCacheDir()
    const personalityDir = path.join(root, ".opencode", "personalities")
    await fs.mkdir(personalityDir, { recursive: true })
    await fs.writeFile(path.join(personalityDir, "Pirate.md"), "Talk like a pirate", "utf8")

    const prev = process.cwd()
    process.chdir(root)
    try {
      const instructions = resolveInstructionsForModel(
        {
          slug: "gpt-5.4-codex",
          model_messages: {
            instructions_template: "Base {{ personality }}"
          }
        },
        "pirate"
      )

      expect(instructions).toBe("Base Talk like a pirate")
    } finally {
      process.chdir(prev)
    }
  })

  it("resolves custom personalities from the provided project root even when cwd differs", async () => {
    const root = await makeCacheDir()
    const projectRoot = path.join(root, "workspace")
    const personalityDir = path.join(projectRoot, ".opencode", "personalities")
    await fs.mkdir(personalityDir, { recursive: true })
    await fs.writeFile(path.join(personalityDir, "Operator.md"), "Workspace operator voice", "utf8")

    const prev = process.cwd()
    process.chdir(root)
    try {
      const instructions = resolveInstructionsForModel(
        {
          slug: "gpt-5.4-codex",
          model_messages: {
            instructions_template: "Base {{ personality }}"
          }
        },
        "operator",
        { projectRoot }
      )

      expect(instructions).toBe("Base Workspace operator voice")
    } finally {
      process.chdir(prev)
    }
  })
})
