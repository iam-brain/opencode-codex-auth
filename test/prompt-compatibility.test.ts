import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

type PromptRules = {
  sources: Array<{ path: string; sha256: string; requiredSymbols: string[] }>
  outputs: Array<{ exportName: string }>
  output: string
}

describe("prompt compatibility artifacts", () => {
  it("matches pinned harness evidence and generated output", () => {
    const root = process.cwd()
    const rules = JSON.parse(
      readFileSync(join(root, "prompts", "prompt-compatibility.rules.json"), "utf8")
    ) as PromptRules

    for (const source of rules.sources) {
      const content = readFileSync(join(root, source.path))
      expect(createHash("sha256").update(content).digest("hex")).toBe(source.sha256)
      const text = content.toString("utf8")
      for (const symbol of source.requiredSymbols) expect(text).toContain(symbol)
    }

    expect(readFileSync(join(root, rules.output), "utf8")).toContain("OpenCode `task` tool")
    expect(rules.outputs.map((output) => output.exportName)).toEqual([
      "ULTRA_PROACTIVE_INSTRUCTIONS",
      "ULTRA_EXPLICIT_ONLY_INSTRUCTIONS"
    ])
    expect(() =>
      execFileSync(process.execPath, ["scripts/generate-prompt-compatibility.mjs", "--check"], {
        cwd: root,
        stdio: "pipe"
      })
    ).not.toThrow()
  })
})
