import { describe, expect, it } from "vitest"

import {
  hasCodexToolNameMarkers,
  mergeInstructions,
  replaceCodexToolCallsForOpenCode,
  resolveHookAgentName
} from "../lib/codex-native/instruction-utils"

describe("Codex instruction utilities", () => {
  it("merges instructions idempotently", () => {
    const merged = mergeInstructions("base", "extra")
    expect(merged).toBe("base\n\nextra")
    expect(mergeInstructions(merged, "extra")).toBe(merged)
  })

  it("adapts Codex tool names without changing ordinary instructions", () => {
    const codexInstructions = "Use spawn_agent and send_input to coordinate workers."
    expect(hasCodexToolNameMarkers(codexInstructions)).toBe(true)
    expect(replaceCodexToolCallsForOpenCode(codexInstructions)).toBe("Use task and task to coordinate workers.")
    expect(replaceCodexToolCallsForOpenCode("Use available tools.")).toBe("Use available tools.")
  })

  it("resolves string and object agent names", () => {
    expect(resolveHookAgentName("build")).toBe("build")
    expect(resolveHookAgentName({ name: "plan" })).toBe("plan")
    expect(resolveHookAgentName({ agent: "custom" })).toBe("custom")
  })
})
