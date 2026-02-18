import { describe, expect, it } from "vitest"

import { runCodexInVivoInstructionProbe } from "./helpers/codex-in-vivo"

describe("codex-native in-vivo instruction replacement", () => {
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

  it("keeps catalog instructions for orchestrator requests in runtime transforms", async () => {
    const result = await runCodexInVivoInstructionProbe({
      hostInstructions: "OpenCode Host Instructions",
      personalityKey: "vivo_persona",
      personalityText: "Vivo Persona Voice",
      agent: "orchestrator",
      collaborationProfileEnabled: true,
      orchestratorSubagentsEnabled: true
    })

    expect(result.outboundInstructions).toContain("Base Vivo Persona Voice")
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
      orchestratorSubagentsEnabled: true
    })

    expect(result.preflightInstructions).toContain("You are Codex, a coding agent based on GPT-5.")
    expect(result.outboundInstructions).toContain("You are Codex, a coding agent based on GPT-5.")
    expect(result.outboundInstructions).toContain("# Sub-agents")
    expect(result.outboundInstructions).not.toContain("Base Vivo Persona Voice")
  })

  it("uses plan mode instructions from codex source with tool replacements", async () => {
    const result = await runCodexInVivoInstructionProbe({
      hostInstructions: "OpenCode Host Instructions",
      personalityKey: "vivo_persona",
      personalityText: "Vivo Persona Voice",
      agent: "plan",
      collaborationProfileEnabled: true
    })

    expect(result.outboundInstructions).toContain("# Plan Mode (Conversational)")
    expect(result.outboundInstructions).toContain("You may explore and execute **non-mutating** actions")
    expect(result.outboundInstructions).toContain(
      "Before asking the user any question, perform at least one targeted non-mutating exploration pass"
    )
    expect(result.outboundInstructions).toContain("request_user_input")
  })

  it("replaces build agent instructions in codex mode", async () => {
    const result = await runCodexInVivoInstructionProbe({
      hostInstructions: "OpenCode Host Instructions",
      personalityKey: "vivo_persona",
      personalityText: "Vivo Persona Voice",
      agent: "build",
      collaborationProfileEnabled: true
    })

    expect(result.outboundInstructions).toContain("Base Vivo Persona Voice")
    expect(result.outboundInstructions).not.toContain("spawn_agent")
  })
})
