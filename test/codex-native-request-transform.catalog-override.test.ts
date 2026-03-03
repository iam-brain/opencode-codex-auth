import { describe, expect, it } from "vitest"

import { applyCatalogInstructionOverrideToRequest } from "../lib/codex-native/request-transform"

describe("catalog instruction override orchestrator preservation gating", () => {
  const catalogModels = [
    {
      slug: "gpt-5.3-codex",
      model_messages: {
        instructions_template: "Base {{ personality }}",
        instructions_variables: {
          personality_default: "Default voice"
        }
      }
    }
  ]

  it("preserves orchestrator-style instructions only when preserve flag is enabled", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        instructions: [
          "You are Codex, a coding agent based on GPT-5.",
          "",
          "# Sub-agents",
          "If `spawn_agent` is unavailable or fails, ignore this section and proceed solo."
        ].join("\n")
      })
    })

    const preserved = await applyCatalogInstructionOverrideToRequest({
      request,
      enabled: true,
      catalogModels,
      behaviorSettings: undefined,
      fallbackPersonality: undefined,
      preserveOrchestratorInstructions: true
    })
    expect(preserved.changed).toBe(false)
    expect(preserved.reason).toBe("orchestrator_instructions_preserved")
    const preservedBody = JSON.parse(await preserved.request.text()) as { instructions?: string }
    expect(preservedBody.instructions).toContain("You are Codex, a coding agent based on GPT-5.")
    expect(preservedBody.instructions).not.toContain("Tooling Compatibility (OpenCode)")

    const replacementRequest = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        instructions: [
          "You are Codex, a coding agent based on GPT-5.",
          "",
          "# Sub-agents",
          "If `spawn_agent` is unavailable or fails, ignore this section and proceed solo."
        ].join("\n")
      })
    })

    const replaced = await applyCatalogInstructionOverrideToRequest({
      request: replacementRequest,
      enabled: true,
      catalogModels,
      behaviorSettings: undefined,
      fallbackPersonality: undefined,
      preserveOrchestratorInstructions: false
    })
    expect(replaced.changed).toBe(true)
    expect(replaced.reason).toBe("updated")
    const body = JSON.parse(await replaced.request.text()) as { instructions?: string }
    expect(body.instructions).toContain("Base Default voice")
  })

  it("preserves orchestrator-style instructions by default when preserve flag is omitted", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        instructions: [
          "You are Codex, a coding agent based on GPT-5.",
          "",
          "# Sub-agents",
          "If `spawn_agent` is unavailable or fails, ignore this section and proceed solo."
        ].join("\n")
      })
    })

    const preserved = await applyCatalogInstructionOverrideToRequest({
      request,
      enabled: true,
      catalogModels,
      behaviorSettings: undefined,
      fallbackPersonality: undefined
    })
    expect(preserved.changed).toBe(false)
    expect(preserved.reason).toBe("orchestrator_instructions_preserved")
    const preservedBody = JSON.parse(await preserved.request.text()) as { instructions?: string }
    expect(preservedBody.instructions).toContain("You are Codex, a coding agent based on GPT-5.")
    expect(preservedBody.instructions).not.toContain("Tooling Compatibility (OpenCode)")
  })

  it("preserves marker-based orchestrator instructions without spawn_agent token", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        instructions: [
          "Any lead-in",
          "# Sub-agents",
          "Coordinate them via wait / send_input.",
          "Ask the user before shutting sub-agents down unless you need to because you reached the agent limit."
        ].join("\n")
      })
    })

    const preserved = await applyCatalogInstructionOverrideToRequest({
      request,
      enabled: true,
      catalogModels,
      behaviorSettings: undefined,
      fallbackPersonality: undefined
    })

    expect(preserved.changed).toBe(false)
    expect(preserved.reason).toBe("orchestrator_instructions_preserved")
    const preservedBody = JSON.parse(await preserved.request.text()) as { instructions?: string }
    expect(preservedBody.instructions).toContain("Coordinate them via wait / send_input.")
    expect(preservedBody.instructions).not.toContain("Tooling Compatibility (OpenCode)")
  })

  it("does not preserve generic wait/send_input prose under sub-agents header", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        instructions: [
          "Operations note",
          "# Sub-agents",
          "Please wait for approval before deploy.",
          "Then send_input from the release form."
        ].join("\n")
      })
    })

    const result = await applyCatalogInstructionOverrideToRequest({
      request,
      enabled: true,
      catalogModels,
      behaviorSettings: undefined,
      fallbackPersonality: undefined
    })

    expect(result.changed).toBe(true)
    expect(result.reason).toBe("updated")
    const body = JSON.parse(await result.request.text()) as { instructions?: string }
    expect(body.instructions).toContain("Base Default voice")
  })

  it("preserves orchestrator instructions when compatibility block already exists with spacing differences", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        instructions: [
          "You are Codex, a coding agent based on GPT-5.",
          "",
          "# Sub-agents",
          "If `task` is unavailable or fails, ignore this section and proceed solo.",
          "",
          "# Notes",
          ""
        ].join("\n")
      })
    })

    const result = await applyCatalogInstructionOverrideToRequest({
      request,
      enabled: true,
      catalogModels,
      behaviorSettings: undefined,
      fallbackPersonality: undefined,
      preserveOrchestratorInstructions: true
    })

    expect(result.changed).toBe(false)
    expect(result.reason).toBe("orchestrator_instructions_preserved")
  })

  it("keeps preserved orchestrator instructions unchanged when no codex tool markers exist", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        instructions: [
          "You are Codex, a coding agent based on GPT-5.",
          "",
          "# Sub-agents",
          "Discuss tradeoffs and summarize worker output before final answer."
        ].join("\n")
      })
    })

    const result = await applyCatalogInstructionOverrideToRequest({
      request,
      enabled: true,
      catalogModels,
      behaviorSettings: undefined,
      fallbackPersonality: undefined,
      preserveOrchestratorInstructions: true
    })

    expect(result.changed).toBe(false)
    expect(result.reason).toBe("orchestrator_instructions_preserved")
  })

  it("replaces codex tool-call names in rendered catalog instructions when enabled", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex"
      })
    })

    const result = await applyCatalogInstructionOverrideToRequest({
      request,
      enabled: true,
      catalogModels: [
        {
          slug: "gpt-5.3-codex",
          model_messages: {
            instructions_template: "Use spawn_agent and send_input with write_stdin; close_agent when done"
          }
        }
      ],
      behaviorSettings: undefined,
      fallbackPersonality: undefined,
      replaceCodexToolCalls: true
    })

    expect(result.changed).toBe(true)
    expect(result.reason).toBe("updated")
    const body = JSON.parse(await result.request.text()) as { instructions?: string }
    expect(body.instructions).toContain("task")
    expect(body.instructions).toContain("skip_task_reuse")
    expect(body.instructions).not.toContain("spawn_agent")
    expect(body.instructions).not.toContain("send_input")
    expect(body.instructions).not.toContain("write_stdin")
  })

  it("updates instructions when rendered text appears only as an incidental substring", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        instructions: "prefix Base Default voice suffix"
      })
    })

    const result = await applyCatalogInstructionOverrideToRequest({
      request,
      enabled: true,
      catalogModels,
      behaviorSettings: undefined,
      fallbackPersonality: undefined
    })

    expect(result.changed).toBe(true)
    expect(result.reason).toBe("updated")
    const body = JSON.parse(await result.request.text()) as { instructions?: string }
    expect(body.instructions).toBe("Base Default voice\n\nprefix Base Default voice suffix")
  })

  it("remains idempotent across repeated transforms when fallback plan header is present", async () => {
    const initialRequest = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        instructions: "# Plan Mode\n\nUse concise sections and produce a concrete plan."
      })
    })

    const first = await applyCatalogInstructionOverrideToRequest({
      request: initialRequest,
      enabled: true,
      catalogModels,
      behaviorSettings: undefined,
      fallbackPersonality: undefined
    })

    expect(first.changed).toBe(true)
    expect(first.reason).toBe("updated")
    const firstBody = JSON.parse(await first.request.text()) as { instructions?: string }
    expect(firstBody.instructions).toContain("# Plan Mode")

    const secondRequest = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        instructions: firstBody.instructions
      })
    })

    const second = await applyCatalogInstructionOverrideToRequest({
      request: secondRequest,
      enabled: true,
      catalogModels,
      behaviorSettings: undefined,
      fallbackPersonality: undefined
    })

    expect(second.changed).toBe(false)
    expect(second.reason).toBe("already_matches")
    const secondBody = JSON.parse(await second.request.text()) as { instructions?: string }
    expect(secondBody.instructions).toBe(firstBody.instructions)
  })
})
