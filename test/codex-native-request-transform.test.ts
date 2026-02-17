import { describe, expect, it } from "vitest"

import {
  applyCatalogInstructionOverrideToRequest,
  remapDeveloperMessagesToUserOnRequest,
  stripReasoningReplayFromRequest
} from "../lib/codex-native/request-transform"

describe("codex request role remap", () => {
  it("remaps non-permissions developer messages to user", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: "Instructions from AGENTS.md" }]
          },
          {
            type: "message",
            role: "developer",
            content: [
              {
                type: "input_text",
                text: "<permissions instructions>\nFilesystem sandboxing defines which files can be read or written"
              }
            ]
          },
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "hello" }]
          }
        ]
      })
    })

    const remapped = await remapDeveloperMessagesToUserOnRequest({
      request,
      enabled: true
    })

    expect(remapped.changed).toBe(true)
    expect(remapped.reason).toBe("updated")
    expect(remapped.remappedCount).toBe(1)
    expect(remapped.preservedCount).toBe(1)

    const body = JSON.parse(await remapped.request.text()) as {
      input: Array<{ role: string }>
    }
    expect(body.input.map((item) => item.role)).toEqual(["user", "developer", "user"])
  })

  it("preserves permissions-only developer messages", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "message",
            role: "developer",
            content: [
              {
                type: "input_text",
                text: "<permissions instructions>\nApproval policy is currently never"
              }
            ]
          }
        ]
      })
    })

    const remapped = await remapDeveloperMessagesToUserOnRequest({
      request,
      enabled: true
    })

    expect(remapped.changed).toBe(false)
    expect(remapped.reason).toBe("permissions_only")
    expect(remapped.remappedCount).toBe(0)
    expect(remapped.preservedCount).toBe(1)
  })

  it("does nothing when remap is disabled", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: "Any developer message" }]
          }
        ]
      })
    })

    const remapped = await remapDeveloperMessagesToUserOnRequest({
      request,
      enabled: false
    })

    expect(remapped.changed).toBe(false)
    expect(remapped.reason).toBe("disabled")
    expect(remapped.remappedCount).toBe(0)
    expect(remapped.preservedCount).toBe(0)
  })

  it("preserves request metadata when body is rewritten", async () => {
    const controller = new AbortController()
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      mode: "cors",
      credentials: "include",
      keepalive: true,
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: "rewrite me" }]
          }
        ]
      })
    })

    const remapped = await remapDeveloperMessagesToUserOnRequest({
      request,
      enabled: true
    })

    expect(remapped.changed).toBe(true)
    expect(remapped.request.keepalive).toBe(true)
    expect(remapped.request.credentials).toBe("include")
    expect(remapped.request.mode).toBe("cors")

    controller.abort()
    expect(remapped.request.signal.aborted).toBe(true)
  })
})

describe("codex reasoning replay stripping", () => {
  it("removes assistant reasoning replay parts and fields", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "message",
            role: "assistant",
            content: [
              { type: "reasoning_summary", text: "secret summary" },
              { type: "output_text", text: "visible", reasoning_content: "should-strip" }
            ]
          },
          {
            type: "reasoning",
            summary: [{ text: "remove whole item" }]
          },
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "keep user input" }]
          }
        ],
        reasoning: {
          effort: "high",
          summary: "auto"
        }
      })
    })

    const stripped = await stripReasoningReplayFromRequest({ request, enabled: true })

    expect(stripped.changed).toBe(true)
    expect(stripped.reason).toBe("updated")
    expect(stripped.removedPartCount).toBe(2)
    expect(stripped.removedFieldCount).toBe(1)

    const body = JSON.parse(await stripped.request.text()) as {
      input: Array<{ role?: string; content?: Array<Record<string, unknown>> }>
      reasoning?: { effort?: string; summary?: string }
    }
    expect(body.input).toHaveLength(2)
    expect(body.input[0]?.role).toBe("assistant")
    expect(body.input[0]?.content).toEqual([{ type: "output_text", text: "visible" }])
    expect(body.reasoning).toEqual({ effort: "high", summary: "auto" })
  })

  it("is a no-op when payload has no reasoning replay artifacts", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "safe output" }]
          },
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "safe input" }]
          }
        ]
      })
    })

    const stripped = await stripReasoningReplayFromRequest({ request, enabled: true })

    expect(stripped.changed).toBe(false)
    expect(stripped.reason).toBe("no_reasoning_replay")
    expect(stripped.removedPartCount).toBe(0)
    expect(stripped.removedFieldCount).toBe(0)
  })
})

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
    expect(preserved.changed).toBe(true)
    expect(preserved.reason).toBe("tooling_compatibility_added")
    const preservedBody = JSON.parse(await preserved.request.text()) as { instructions?: string }
    expect(preservedBody.instructions).toContain("You are Codex, a coding agent based on GPT-5.")
    expect(preservedBody.instructions).toContain("Tooling Compatibility (OpenCode)")

    const replaced = await applyCatalogInstructionOverrideToRequest({
      request,
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
    expect(preserved.changed).toBe(true)
    expect(preserved.reason).toBe("tooling_compatibility_added")
    const preservedBody = JSON.parse(await preserved.request.text()) as { instructions?: string }
    expect(preservedBody.instructions).toContain("You are Codex, a coding agent based on GPT-5.")
    expect(preservedBody.instructions).toContain("Tooling Compatibility (OpenCode)")
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

    expect(preserved.changed).toBe(true)
    expect(preserved.reason).toBe("tooling_compatibility_added")
    const preservedBody = JSON.parse(await preserved.request.text()) as { instructions?: string }
    expect(preservedBody.instructions).toContain("Coordinate them via wait / send_input.")
    expect(preservedBody.instructions).toContain("Tooling Compatibility (OpenCode)")
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

  it("does not report compatibility-added when compatibility block already exists with spacing differences", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        instructions: [
          "You are Codex, a coding agent based on GPT-5.",
          "",
          "# Sub-agents",
          "If `spawn_agent` is unavailable or fails, ignore this section and proceed solo.",
          "",
          "# Tooling Compatibility (OpenCode)",
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
})
