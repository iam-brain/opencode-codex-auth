import { describe, expect, it } from "vitest"

import { CodexAuthPlugin } from "../lib/codex-native"

async function runChatParams(input: {
  pluginOptions?: Record<string, unknown>
  agent: string
  sessionID: string
  modelOptions?: Record<string, unknown>
}) {
  const hooks = await CodexAuthPlugin({} as never, input.pluginOptions as never)
  const chatParams = hooks["chat.params"]
  expect(chatParams).toBeTypeOf("function")

  const output: any = {
    temperature: 0,
    topP: 1,
    topK: 0,
    options: {}
  }

  await chatParams?.(
    {
      sessionID: input.sessionID,
      agent: input.agent,
      provider: {},
      message: {},
      model: {
        providerID: "openai",
        capabilities: { toolcall: true },
        options: input.modelOptions ?? {}
      }
    } as never,
    output
  )

  return output
}

async function runChatHeaders(input: { pluginOptions?: Record<string, unknown>; agent: string; sessionID: string }) {
  const hooks = await CodexAuthPlugin({} as never, input.pluginOptions as never)
  const chatHeaders = hooks["chat.headers"]
  expect(chatHeaders).toBeTypeOf("function")

  const output: any = { headers: {} as Record<string, string> }
  await chatHeaders?.(
    {
      sessionID: input.sessionID,
      agent: input.agent,
      model: { providerID: "openai", options: {} }
    } as never,
    output
  )
  return output.headers
}

describe("codex-native collaboration runtime", () => {
  it("injects collaboration instructions for Codex agents by default in codex mode", async () => {
    const output = await runChatParams({
      pluginOptions: { spoofMode: "codex", mode: "codex" },
      sessionID: "ses_codex_mode_no_collab",
      agent: "Codex Plan",
      modelOptions: {
        codexInstructions: "Catalog instructions",
        codexRuntimeDefaults: {
          defaultReasoningEffort: "high"
        }
      }
    })

    expect(output.options.instructions).toContain("Catalog instructions")
    expect(output.options.instructions).toContain("# Plan Mode")
    expect(output.options.instructions).not.toContain("request_user_input")
    expect(output.options.instructions).not.toContain("Tooling Compatibility (OpenCode)")
  })

  it("replaces build agent instructions in codex mode without execute preset", async () => {
    const output = await runChatParams({
      pluginOptions: { spoofMode: "codex" },
      sessionID: "ses_native_agent_passthrough",
      agent: "build",
      modelOptions: {
        codexInstructions: "Catalog instructions",
        codexRuntimeDefaults: {
          defaultReasoningEffort: "high"
        }
      }
    })

    expect(output.options.instructions).toContain("Catalog instructions")
    expect(output.options.instructions).not.toContain("# Collaboration Style: Execute")
    expect(output.options.instructions).not.toContain("# Plan Mode")
    expect(output.options.reasoningEffort).toBe("high")
  })

  it("keeps build-agent instruction replacement active when collaboration profile is disabled", async () => {
    const output = await runChatParams({
      pluginOptions: {
        spoofMode: "codex",
        collaborationProfileEnabled: false
      },
      sessionID: "ses_build_no_collab",
      agent: "build",
      modelOptions: {
        codexInstructions: "Use spawn_agent and send_input with write_stdin",
        codexRuntimeDefaults: {
          defaultReasoningEffort: "high"
        }
      }
    })

    expect(output.options.instructions).toContain("task")
    expect(output.options.instructions).not.toContain("spawn_agent")
    expect(output.options.instructions).not.toContain("send_input")
    expect(output.options.instructions).not.toContain("write_stdin")
  })

  it("sets collaboration headers for Codex agents by default in codex mode", async () => {
    const headers = await runChatHeaders({
      pluginOptions: { spoofMode: "codex", mode: "codex" },
      sessionID: "ses_codex_headers_no_collab",
      agent: "Codex Review"
    })

    expect(headers["x-openai-subagent"]).toBe("review")
    expect(headers["x-opencode-collaboration-mode-kind"]).toBe("code")
  })

  it("does not set codex collaboration headers for native OpenCode agents", async () => {
    const headers = await runChatHeaders({
      pluginOptions: { spoofMode: "codex" },
      sessionID: "ses_native_headers_passthrough",
      agent: "explore"
    })

    expect(headers["x-openai-subagent"]).toBeUndefined()
    expect(headers["x-opencode-collaboration-mode-kind"]).toBeUndefined()
  })

  it("allows collaboration headers in native mode without runtime instruction injection", async () => {
    const params = await runChatParams({
      pluginOptions: {
        spoofMode: "native",
        mode: "native",
        collaborationProfileEnabled: true,
        orchestratorSubagentsEnabled: true
      },
      sessionID: "ses_native_collab_params",
      agent: "orchestrator",
      modelOptions: {
        codexInstructions: "Catalog instructions"
      }
    })

    expect(params.options.instructions).toContain("Catalog instructions")
    expect(params.options.instructions).not.toContain("# Sub-agents")
    expect(params.options.instructions).not.toContain("# Collaboration Style: Execute")

    const headers = await runChatHeaders({
      pluginOptions: {
        spoofMode: "native",
        mode: "native",
        collaborationProfileEnabled: true,
        orchestratorSubagentsEnabled: true
      },
      sessionID: "ses_native_collab_headers",
      agent: "Codex Review"
    })
    expect(headers["x-opencode-collaboration-mode-kind"]).toBe("code")
    expect(headers["x-openai-subagent"]).toBe("review")
  })

  it("injects plan-mode collaboration instructions when collaboration profile is enabled", async () => {
    const output = await runChatParams({
      pluginOptions: {
        spoofMode: "codex",
        mode: "codex",
        collaborationProfileEnabled: true
      },
      sessionID: "ses_plan_collab_enabled",
      agent: "plan",
      modelOptions: {
        codexInstructions: "Catalog instructions"
      }
    })

    expect(output.options.instructions).toContain("Catalog instructions")
    expect(output.options.instructions).toContain("# Plan Mode")
  })

  it("does not append orchestrator profile instructions at runtime", async () => {
    const output = await runChatParams({
      pluginOptions: {
        spoofMode: "codex",
        mode: "codex",
        collaborationProfileEnabled: true,
        orchestratorSubagentsEnabled: true
      },
      sessionID: "ses_orchestrator_collab_enabled",
      agent: "orchestrator",
      modelOptions: {
        codexInstructions: "Catalog instructions"
      }
    })

    expect(output.options.instructions).toContain("Catalog instructions")
  })

  it("preserves orchestrator instructions instead of replacing them with model base instructions", async () => {
    const hooks = await CodexAuthPlugin(
      {} as never,
      {
        spoofMode: "codex",
        mode: "codex",
        collaborationProfileEnabled: true,
        orchestratorSubagentsEnabled: true
      } as never
    )
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const output: any = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {
        instructions: [
          "You are Codex, a coding agent based on GPT-5.",
          "",
          "# Sub-agents",
          "If `spawn_agent` is unavailable or fails, ignore this section and proceed solo."
        ].join("\n")
      }
    }

    await chatParams?.(
      {
        sessionID: "ses_orchestrator_preserve",
        agent: "orchestrator",
        provider: {},
        message: {},
        model: {
          providerID: "openai",
          capabilities: { toolcall: true },
          options: {
            codexInstructions: "Catalog instructions"
          }
        }
      } as never,
      output
    )

    expect(output.options.instructions).toContain("You are Codex, a coding agent based on GPT-5.")
    expect(output.options.instructions).toContain("# Sub-agents")
    expect(output.options.instructions).toContain("spawn_agent")
    expect(output.options.instructions).not.toContain("Tooling Compatibility (OpenCode)")
    expect(output.options.instructions).not.toContain("Catalog instructions")
  })

  it("does not set collaboration headers for legacy Orchestrator agent names", async () => {
    const headers = await runChatHeaders({
      pluginOptions: { spoofMode: "codex" },
      sessionID: "ses_legacy_orchestrator_passthrough",
      agent: "Orchestrator-Plan"
    })

    expect(headers["x-openai-subagent"]).toBeUndefined()
    expect(headers["x-opencode-collaboration-mode-kind"]).toBeUndefined()
  })

  it("sets plan-mode collaboration headers when collaboration profile is enabled", async () => {
    const headers = await runChatHeaders({
      pluginOptions: {
        spoofMode: "codex",
        mode: "codex",
        collaborationProfileEnabled: true
      },
      sessionID: "ses_plan_collab_headers",
      agent: "plan"
    })

    expect(headers["x-opencode-collaboration-mode-kind"]).toBe("plan")
    expect(headers["x-opencode-collaboration-agent-kind"]).toBe("plan")
    expect(headers["x-openai-subagent"]).toBeUndefined()
  })

  it("sets subagent and collaboration headers for codex review helpers", async () => {
    const headers = await runChatHeaders({
      pluginOptions: {
        spoofMode: "codex",
        mode: "codex",
        collaborationProfileEnabled: true,
        orchestratorSubagentsEnabled: true
      },
      sessionID: "ses_review_collab_headers",
      agent: "Codex Review"
    })

    expect(headers["x-opencode-collaboration-mode-kind"]).toBe("code")
    expect(headers["x-opencode-collaboration-agent-kind"]).toBe("code")
    expect(headers["x-openai-subagent"]).toBe("review")
  })

  it("sets orchestrator collaboration agent header for orchestrator profile", async () => {
    const headers = await runChatHeaders({
      pluginOptions: {
        spoofMode: "codex",
        mode: "codex",
        collaborationProfileEnabled: true,
        orchestratorSubagentsEnabled: true
      },
      sessionID: "ses_orchestrator_collab_headers",
      agent: "orchestrator"
    })

    expect(headers["x-opencode-collaboration-mode-kind"]).toBe("code")
    expect(headers["x-opencode-collaboration-agent-kind"]).toBe("orchestrator")
  })
})
