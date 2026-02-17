import { describe, expect, it } from "vitest"

import { runCodexInVivoInstructionProbe } from "./helpers/codex-in-vivo"

describe("codex-native in-vivo instruction injection", () => {
  it("replaces host instructions and sends personality-rendered instructions in codex mode", async () => {
    const result = await runCodexInVivoInstructionProbe({
      hostInstructions: "OpenCode Host Instructions",
      personalityKey: "vivo_persona",
      personalityText: "Vivo Persona Voice"
    })

    expect(result.preflightInstructions).toBe("Base Vivo Persona Voice")
    expect(result.outboundInstructions).toBe("Base Vivo Persona Voice")
    expect(result.outboundInstructions).not.toBe("OpenCode Host Instructions")
    expect(result.outboundUrl).toBe("https://chatgpt.com/backend-api/codex/responses")
    expect(result.outboundOriginator).toMatch(/^codex_/)
    expect(result.outboundUserAgent).toMatch(/^codex_/)
  })

  it("replaces host instructions at outbound even when model options are stripped", async () => {
    const result = await runCodexInVivoInstructionProbe({
      hostInstructions: "OpenCode Host Instructions",
      personalityKey: "vivo_persona",
      personalityText: "Vivo Persona Voice",
      stripModelOptionsBeforeParams: true,
      modelInstructionsFallback: "OpenCode Host Instructions",
      omitModelIdentityBeforeParams: true
    })

    expect(result.preflightInstructions).toBe("OpenCode Host Instructions")
    expect(result.outboundInstructions).toBe("Base Vivo Persona Voice")
    expect(result.outboundInstructions).not.toBe("OpenCode Host Instructions")
  })

  it("injects codex-to-opencode tool call replacements for orchestrator prompts", async () => {
    const result = await runCodexInVivoInstructionProbe({
      hostInstructions: "OpenCode Host Instructions",
      personalityKey: "vivo_persona",
      personalityText: "Vivo Persona Voice",
      agent: "orchestrator",
      collaborationProfileEnabled: true,
      orchestratorSubagentsEnabled: true,
      collaborationToolProfile: "opencode"
    })

    expect(result.outboundInstructions).toContain("# Sub-agents")
    expect(result.outboundInstructions).toContain("spawn_agent -> task")
    expect(result.outboundInstructions).toContain("send_input -> task with existing task_id")
    expect(result.outboundInstructions).toContain("wait -> do not return final output")
    expect(result.outboundInstructions).toContain("close_agent -> stop reusing task_id")
  })

  it("keeps orchestrator agent instructions instead of replacing them with model base instructions", async () => {
    const result = await runCodexInVivoInstructionProbe({
      hostInstructions: [
        "You are Codex, a coding agent based on GPT-5.",
        "",
        "# Sub-agents",
        "If `spawn_agent` is unavailable or fails, ignore this section and proceed solo."
      ].join("\n"),
      personalityKey: "vivo_persona",
      personalityText: "Vivo Persona Voice",
      agent: "orchestrator",
      collaborationProfileEnabled: true,
      orchestratorSubagentsEnabled: true,
      collaborationToolProfile: "opencode"
    })

    expect(result.preflightInstructions).toContain("You are Codex, a coding agent based on GPT-5.")
    expect(result.outboundInstructions).toContain("You are Codex, a coding agent based on GPT-5.")
    expect(result.outboundInstructions).toContain("# Sub-agents")
    expect(result.outboundInstructions).not.toContain("Base Vivo Persona Voice")
  })

  it("injects plan mode semantics plus tool replacements for plan agent", async () => {
    const result = await runCodexInVivoInstructionProbe({
      hostInstructions: "OpenCode Host Instructions",
      personalityKey: "vivo_persona",
      personalityText: "Vivo Persona Voice",
      agent: "plan",
      collaborationProfileEnabled: true,
      collaborationToolProfile: "opencode"
    })

    expect(result.outboundInstructions).toContain("# Plan Mode (Conversational)")
    expect(result.outboundInstructions).toContain("You may explore and execute **non-mutating** actions")
    expect(result.outboundInstructions).toContain(
      "Before asking the user any question, perform at least one targeted non-mutating exploration pass"
    )
    expect(result.outboundInstructions).toContain("spawn_agent -> task")
  })
})
