import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { CodexAuthPlugin } from "../lib/codex-native"

type HookInput = {
  sessionID: string
  model: {
    providerID: string
    capabilities?: {
      toolcall?: boolean
    }
    options?: Record<string, unknown>
  }
}

async function withArgv<T>(argv: string[], run: () => Promise<T>): Promise<T> {
  const previous = process.argv.slice()
  process.argv = argv
  try {
    return await run()
  } finally {
    process.argv = previous
  }
}

describe("codex-native spoof + params hooks", () => {
  it("maps catalog instructions/runtime defaults into chat.params", async () => {
    const hooks = await CodexAuthPlugin({} as never)
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_123",
      agent: "default",
      provider: {},
      message: {},
      model: {
        providerID: "openai",
        capabilities: { toolcall: true },
        options: {
          codexInstructions: "Catalog instructions",
          codexRuntimeDefaults: {
            applyPatchToolType: "apply_patch",
            defaultReasoningEffort: "high",
            supportsReasoningSummaries: true,
            defaultVerbosity: "medium"
          }
        }
      }
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const output = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {
        include: ["web_search_call.action.sources"]
      }
    }

    await chatParams?.(input, output)

    expect(output.options.instructions).toBe("Catalog instructions")
    expect(output.options.reasoningEffort).toBe("high")
    expect(output.options.reasoningSummary).toBe("auto")
    expect(output.options.textVerbosity).toBe("medium")
    expect(output.options.parallelToolCalls).toBe(true)
    expect(output.options.applyPatchToolType).toBe("apply_patch")
    expect(output.options.include).toEqual([
      "web_search_call.action.sources",
      "reasoning.encrypted_content"
    ])
  })

  it("keeps explicit host options in chat.params", async () => {
    const hooks = await CodexAuthPlugin({} as never)
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_123",
      agent: "default",
      provider: {},
      message: {},
      model: {
        providerID: "openai",
        capabilities: { toolcall: true },
        options: {
          codexInstructions: "Catalog instructions",
          codexRuntimeDefaults: {
            defaultReasoningEffort: "high",
            supportsReasoningSummaries: true,
            defaultVerbosity: "low"
          }
        }
      }
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const output = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {
        instructions: "Host instructions",
        reasoningEffort: "minimal",
        reasoningSummary: "none",
        textVerbosity: "high",
        parallelToolCalls: false,
        include: ["reasoning.encrypted_content"]
      }
    }

    await chatParams?.(input, output)

    expect(output.options.instructions).toBe("Host instructions")
    expect(output.options.reasoningEffort).toBe("minimal")
    expect(output.options.reasoningSummary).toBe("none")
    expect(output.options.textVerbosity).toBe("high")
    expect(output.options.parallelToolCalls).toBe(false)
    expect(output.options.include).toEqual(["reasoning.encrypted_content"])
  })

  it("applies global custom_settings personality in chat.params", async () => {
    const hooks = await CodexAuthPlugin({} as never, {
      customSettings: {
        options: { personality: "friendly" }
      }
    })
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_123",
      agent: "default",
      provider: {},
      message: {},
      model: {
        id: "gpt-5.3-codex",
        api: { id: "gpt-5.3-codex" },
        providerID: "openai",
        capabilities: { toolcall: true },
        options: {
          codexCatalogModel: {
            slug: "gpt-5.3-codex",
            model_messages: {
              instructions_template: "Base {{ personality }}",
              instructions_variables: {
                personality_friendly: "Friendly voice"
              }
            }
          },
          codexRuntimeDefaults: {
            defaultReasoningEffort: "medium"
          }
        }
      }
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const output = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {}
    }

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-spoof-global-"))
    const prevCwd = process.cwd()
    const prevXdg = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = path.join(root, "xdg-empty")
    process.chdir(root)
    try {
      await chatParams?.(input, output)
      expect(output.options.instructions).toBe("Base Friendly voice")
    } finally {
      process.chdir(prevCwd)
      if (prevXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = prevXdg
      }
    }
  })

  it("applies per-model custom_settings personality override", async () => {
    const hooks = await CodexAuthPlugin({} as never, {
      customSettings: {
        options: { personality: "friendly" },
        models: {
          "gpt-5.3-codex": {
            options: { personality: "pragmatic" }
          }
        }
      }
    })
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_123",
      agent: "default",
      provider: {},
      message: {},
      model: {
        id: "gpt-5.3-codex",
        api: { id: "gpt-5.3-codex" },
        providerID: "openai",
        capabilities: { toolcall: true },
        options: {
          codexCatalogModel: {
            slug: "gpt-5.3-codex",
            model_messages: {
              instructions_template: "Base {{ personality }}",
              instructions_variables: {
                personality_friendly: "Friendly voice",
                personality_pragmatic: "Pragmatic voice"
              }
            }
          },
          codexRuntimeDefaults: {
            defaultReasoningEffort: "medium"
          }
        }
      }
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const output = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {}
    }

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-spoof-model-"))
    const prevCwd = process.cwd()
    const prevXdg = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = path.join(root, "xdg-empty")
    process.chdir(root)
    try {
      await chatParams?.(input, output)
      expect(output.options.instructions).toBe("Base Pragmatic voice")
    } finally {
      process.chdir(prevCwd)
      if (prevXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = prevXdg
      }
    }
  })

  it("prefers per-variant personality over per-model and global", async () => {
    const hooks = await CodexAuthPlugin({} as never, {
      customSettings: {
        options: { personality: "friendly" },
        models: {
          "gpt-5.3-codex": {
            options: { personality: "pragmatic" },
            variants: {
              high: { options: { personality: "strict" } }
            }
          }
        }
      }
    })
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_123",
      agent: "default",
      provider: {},
      message: { variant: "high" },
      model: {
        id: "gpt-5.3-codex",
        api: { id: "gpt-5.3-codex" },
        providerID: "openai",
        capabilities: { toolcall: true },
        options: {
          codexCatalogModel: {
            slug: "gpt-5.3-codex",
            model_messages: {
              instructions_template: "Base {{ personality }}",
              instructions_variables: {
                personality_friendly: "Friendly voice",
                personality_pragmatic: "Pragmatic voice",
                personalities: {
                  strict: "Strict voice"
                }
              }
            }
          },
          codexRuntimeDefaults: {
            defaultReasoningEffort: "medium"
          }
        }
      }
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const output = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {}
    }

    await chatParams?.(input, output)
    expect(output.options.instructions).toBe("Base Strict voice")
  })

  it("honors thinking_summaries false override", async () => {
    const hooks = await CodexAuthPlugin({} as never, {
      customSettings: {
        thinkingSummaries: false
      }
    })
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_123",
      agent: "default",
      provider: {},
      message: {},
      model: {
        id: "gpt-5.3-codex",
        api: { id: "gpt-5.3-codex" },
        providerID: "openai",
        capabilities: { toolcall: true },
        options: {
          codexInstructions: "Catalog instructions",
          codexRuntimeDefaults: {
            defaultReasoningEffort: "high",
            supportsReasoningSummaries: true
          }
        }
      }
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const output = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {}
    }

    await chatParams?.(input, output)
    expect(output.options.reasoningSummary).toBe("none")
  })

  it("prefers per-model thinking summaries over global setting", async () => {
    const hooks = await CodexAuthPlugin({} as never, {
      customSettings: {
        thinkingSummaries: true,
        models: {
          "gpt-5.3-codex": {
            thinkingSummaries: false
          }
        }
      }
    })
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_123",
      agent: "default",
      provider: {},
      message: {},
      model: {
        id: "gpt-5.3-codex",
        api: { id: "gpt-5.3-codex" },
        providerID: "openai",
        capabilities: { toolcall: true },
        options: {
          codexInstructions: "Catalog instructions",
          codexRuntimeDefaults: {
            defaultReasoningEffort: "high",
            supportsReasoningSummaries: true
          }
        }
      }
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const output = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {}
    }

    await chatParams?.(input, output)
    expect(output.options.reasoningSummary).toBe("none")
  })

  it("prefers per-variant thinking summaries over per-model and global", async () => {
    const hooks = await CodexAuthPlugin({} as never, {
      customSettings: {
        thinkingSummaries: false,
        models: {
          "gpt-5.3-codex": {
            thinkingSummaries: false,
            variants: {
              high: { thinkingSummaries: true }
            }
          }
        }
      }
    })
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_123",
      agent: "default",
      provider: {},
      message: { variant: "high" },
      model: {
        id: "gpt-5.3-codex",
        api: { id: "gpt-5.3-codex" },
        providerID: "openai",
        capabilities: { toolcall: true },
        options: {
          codexInstructions: "Catalog instructions",
          codexRuntimeDefaults: {
            defaultReasoningEffort: "high",
            supportsReasoningSummaries: true
          }
        }
      }
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const output = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {}
    }

    await chatParams?.(input, output)
    expect(output.options.reasoningSummary).toBe("auto")
  })

  it("skips incompatible catalog instructions to avoid stale bridge/tool markers", async () => {
    const hooks = await CodexAuthPlugin({} as never)
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_guardrail",
      agent: "default",
      provider: {},
      message: {},
      model: {
        id: "gpt-5.3-codex",
        api: { id: "gpt-5.3-codex" },
        providerID: "openai",
        capabilities: { toolcall: true },
        options: {
          codexCatalogModel: {
            slug: "gpt-5.3-codex",
            model_messages: {
              instructions_template:
                "Use multi_tool_use.parallel with recipient_name=functions.read"
            }
          }
        }
      }
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const output = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {}
    }

    await chatParams?.(input, output)
    expect(output.options.instructions).toBeUndefined()
  })

  it("maps Codex Plan agent to codex collaboration plan profile in collab mode", async () => {
    const hooks = await CodexAuthPlugin({} as never, { spoofMode: "codex", mode: "collab" })
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_plan_mode",
      agent: "Codex Plan",
      provider: {},
      message: {},
      model: {
        providerID: "openai",
        capabilities: { toolcall: true },
        options: {
          codexInstructions: "Catalog instructions",
          codexRuntimeDefaults: {
            defaultReasoningEffort: "high",
            supportsReasoningSummaries: true
          }
        }
      }
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const output = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {}
    }

    await chatParams?.(input, output)
    expect(output.options.instructions).toContain("Catalog instructions")
    expect(output.options.instructions).toContain("# Plan Mode")
    expect(output.options.reasoningEffort).toBe("medium")
    expect(output.options.reasoningSummary).toBe("auto")
  })

  it("maps Codex Orchestrator agent to codex collaboration code profile in collab mode", async () => {
    const hooks = await CodexAuthPlugin({} as never, { spoofMode: "codex", mode: "collab" })
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_code_mode",
      agent: "Codex Orchestrator",
      provider: {},
      message: {},
      model: {
        providerID: "openai",
        capabilities: { toolcall: true },
        options: {
          codexInstructions: "Catalog instructions",
          codexRuntimeDefaults: {
            defaultReasoningEffort: "high"
          }
        }
      }
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const output = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {}
    }

    await chatParams?.(input, output)
    expect(output.options.instructions).toContain("Catalog instructions")
    expect(output.options.instructions).toContain("you are now in code mode.")
    expect(output.options.reasoningEffort).toBe("high")
  })

  it("supports object-style hook agent payload when resolving Codex collaboration mode", async () => {
    const hooks = await CodexAuthPlugin({} as never, { spoofMode: "codex", mode: "collab" })
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_plan_object",
      agent: { name: "Codex Plan", mode: "primary" },
      provider: {},
      message: {},
      model: {
        providerID: "openai",
        capabilities: { toolcall: true },
        options: {
          codexInstructions: "Catalog instructions"
        }
      }
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const output = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {}
    }

    await chatParams?.(input, output)
    expect(output.options.instructions).toContain("# Plan Mode")
  })

  it("maps Codex Execute agent to codex collaboration execute profile in collab mode", async () => {
    const hooks = await CodexAuthPlugin({} as never, { spoofMode: "codex", mode: "collab" })
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_execute_mode",
      agent: "Codex Execute",
      provider: {},
      message: {},
      model: {
        providerID: "openai",
        capabilities: { toolcall: true },
        options: {
          codexInstructions: "Catalog instructions"
        }
      }
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const output = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {}
    }

    await chatParams?.(input, output)
    expect(output.options.instructions).toContain("Catalog instructions")
    expect(output.options.instructions).toContain("# Collaboration Style: Execute")
    expect(output.options.reasoningEffort).toBe("high")
  })

  it("does not inject collaboration instructions for Codex agents in codex mode", async () => {
    const hooks = await CodexAuthPlugin({} as never, { spoofMode: "codex", mode: "codex" })
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_codex_mode_no_collab",
      agent: "Codex Plan",
      provider: {},
      message: {},
      model: {
        providerID: "openai",
        capabilities: { toolcall: true },
        options: {
          codexInstructions: "Catalog instructions",
          codexRuntimeDefaults: {
            defaultReasoningEffort: "high"
          }
        }
      }
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const output = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {}
    }

    await chatParams?.(input, output)
    expect(output.options.instructions).toBe("Catalog instructions")
    expect(output.options.instructions).not.toContain("# Plan Mode")
  })

  it("does not enable codex collaboration profile for native OpenCode agents", async () => {
    const hooks = await CodexAuthPlugin({} as never, { spoofMode: "codex" })
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_native_agent_passthrough",
      agent: "build",
      provider: {},
      message: {},
      model: {
        providerID: "openai",
        capabilities: { toolcall: true },
        options: {
          codexInstructions: "Catalog instructions",
          codexRuntimeDefaults: {
            defaultReasoningEffort: "high"
          }
        }
      }
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const output = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {}
    }

    await chatParams?.(input, output)
    expect(output.options.instructions).toBe("Catalog instructions")
    expect(output.options.instructions).not.toContain("you are now in code mode.")
    expect(output.options.instructions).not.toContain("# Plan Mode")
    expect(output.options.reasoningEffort).toBe("high")
  })

  it("uses native headers by default (legacy-plugin style)", async () => {
    const hooks = await CodexAuthPlugin({} as never)
    const chatHeaders = hooks["chat.headers"]
    expect(chatHeaders).toBeTypeOf("function")

    const input = {
      sessionID: "ses_native",
      model: { providerID: "openai", options: { promptCacheKey: "ses_prompt_native" } }
    } as unknown as Parameters<NonNullable<typeof chatHeaders>>[0]

    const output = { headers: {} as Record<string, string> }
    await chatHeaders?.(input, output)

    expect(output.headers.originator).toBe("codex_cli_rs")
    expect(output.headers["User-Agent"]).toContain("opencode-codex-auth")
    expect(output.headers.session_id).toBe("ses_prompt_native")
    expect(output.headers.conversation_id).toBe("ses_prompt_native")
    expect(output.headers["OpenAI-Beta"]).toBe("responses=experimental")
  })

  it("omits conversation/session headers in native mode when prompt cache key is absent", async () => {
    const hooks = await CodexAuthPlugin({} as never, { spoofMode: "native" })
    const chatHeaders = hooks["chat.headers"]
    expect(chatHeaders).toBeTypeOf("function")

    const input = {
      sessionID: "ses_no_prompt_cache",
      model: { providerID: "openai", options: {} }
    } as unknown as Parameters<NonNullable<typeof chatHeaders>>[0]

    const output = { headers: {} as Record<string, string> }
    await chatHeaders?.(input, output)

    expect(output.headers.originator).toBe("codex_cli_rs")
    expect(output.headers["User-Agent"]).toContain("opencode-codex-auth")
    expect(output.headers.session_id).toBeUndefined()
    expect(output.headers.conversation_id).toBeUndefined()
    expect(output.headers["OpenAI-Beta"]).toBe("responses=experimental")
  })

  it("uses codex-mode headers when configured", async () => {
    const hooks = await CodexAuthPlugin({} as never, { spoofMode: "codex" })
    const chatHeaders = hooks["chat.headers"]
    expect(chatHeaders).toBeTypeOf("function")

    const input = {
      sessionID: "ses_strict",
      model: {
        providerID: "openai",
        options: {
          promptCacheKey: "ses_prompt_key"
        }
      }
    } as unknown as Parameters<NonNullable<typeof chatHeaders>>[0]

    const output = { headers: {} as Record<string, string> }
    await chatHeaders?.(input, output)

    expect(output.headers.originator).toBe("codex_cli_rs")
    expect(output.headers["User-Agent"]).toMatch(/^codex_cli_rs\//)
    expect(output.headers.session_id).toBe("ses_prompt_key")
    expect(output.headers["OpenAI-Beta"]).toBeUndefined()
    expect(output.headers.conversation_id).toBeUndefined()
  })

  it("uses codex_exec originator for codex mode during `opencode run`", async () => {
    await withArgv(["bun", "opencode", "run"], async () => {
      const hooks = await CodexAuthPlugin({} as never, { spoofMode: "codex" })
      const chatHeaders = hooks["chat.headers"]
      expect(chatHeaders).toBeTypeOf("function")

      const input = {
        sessionID: "ses_codex_exec",
        model: { providerID: "openai", options: {} }
      } as unknown as Parameters<NonNullable<typeof chatHeaders>>[0]

      const output = { headers: {} as Record<string, string> }
      await chatHeaders?.(input, output)
      expect(output.headers.originator).toBe("codex_exec")
      expect(output.headers["User-Agent"]).toMatch(/^codex_exec\//)
    })
  })

  it("prefers codex_cli_rs originator in codex mode for TUI worker invocations", async () => {
    await withArgv(["bun", "/tmp/cli/cmd/tui/worker.js", "run"], async () => {
      const hooks = await CodexAuthPlugin({} as never, { spoofMode: "codex" })
      const chatHeaders = hooks["chat.headers"]
      expect(chatHeaders).toBeTypeOf("function")

      const input = {
        sessionID: "ses_codex_tui",
        model: { providerID: "openai", options: {} }
      } as unknown as Parameters<NonNullable<typeof chatHeaders>>[0]

      const output = { headers: {} as Record<string, string> }
      await chatHeaders?.(input, output)
      expect(output.headers.originator).toBe("codex_cli_rs")
      expect(output.headers["User-Agent"]).toMatch(/^codex_cli_rs\//)
    })
  })

  it("uses sessionID as codex-mode session_id when prompt cache key is absent", async () => {
    const hooks = await CodexAuthPlugin({} as never, { spoofMode: "codex" })
    const chatHeaders = hooks["chat.headers"]
    expect(chatHeaders).toBeTypeOf("function")

    const input = {
      sessionID: "ses_strict_fallback",
      model: { providerID: "openai", options: {} }
    } as unknown as Parameters<NonNullable<typeof chatHeaders>>[0]

    const output = { headers: {} as Record<string, string> }
    await chatHeaders?.(input, output)

    expect(output.headers.originator).toBe("codex_cli_rs")
    expect(output.headers["User-Agent"]).toMatch(/^codex_cli_rs\//)
    expect(output.headers.session_id).toBe("ses_strict_fallback")
    expect(output.headers["OpenAI-Beta"]).toBeUndefined()
    expect(output.headers.conversation_id).toBeUndefined()
  })

  it("adds codex subagent header for Codex Review subagent in collab mode", async () => {
    const hooks = await CodexAuthPlugin({} as never, { spoofMode: "codex", mode: "collab" })
    const chatHeaders = hooks["chat.headers"]
    expect(chatHeaders).toBeTypeOf("function")

    const input = {
      sessionID: "ses_subagent",
      agent: "Codex Review",
      model: { providerID: "openai", options: {} }
    } as unknown as Parameters<NonNullable<typeof chatHeaders>>[0]

    const output = { headers: {} as Record<string, string> }
    await chatHeaders?.(input, output)

    expect(output.headers["x-openai-subagent"]).toBe("review")
    expect(output.headers["x-opencode-collaboration-mode-kind"]).toBe("code")
  })

  it("sets plan collaboration mode marker without subagent header for Codex Plan agent in collab mode", async () => {
    const hooks = await CodexAuthPlugin({} as never, { spoofMode: "codex", mode: "collab" })
    const chatHeaders = hooks["chat.headers"]
    expect(chatHeaders).toBeTypeOf("function")

    const input = {
      sessionID: "ses_plan_agent_headers",
      agent: "Codex Plan",
      model: { providerID: "openai", options: {} }
    } as unknown as Parameters<NonNullable<typeof chatHeaders>>[0]

    const output = { headers: {} as Record<string, string> }
    await chatHeaders?.(input, output)

    expect(output.headers["x-openai-subagent"]).toBeUndefined()
    expect(output.headers["x-opencode-collaboration-mode-kind"]).toBe("plan")
  })

  it("does not set collaboration headers for Codex agents in codex mode", async () => {
    const hooks = await CodexAuthPlugin({} as never, { spoofMode: "codex", mode: "codex" })
    const chatHeaders = hooks["chat.headers"]
    expect(chatHeaders).toBeTypeOf("function")

    const input = {
      sessionID: "ses_codex_headers_no_collab",
      agent: "Codex Review",
      model: { providerID: "openai", options: {} }
    } as unknown as Parameters<NonNullable<typeof chatHeaders>>[0]

    const output = { headers: {} as Record<string, string> }
    await chatHeaders?.(input, output)

    expect(output.headers["x-openai-subagent"]).toBeUndefined()
    expect(output.headers["x-opencode-collaboration-mode-kind"]).toBeUndefined()
  })

  it("does not set codex collaboration headers for native OpenCode agents", async () => {
    const hooks = await CodexAuthPlugin({} as never, { spoofMode: "codex" })
    const chatHeaders = hooks["chat.headers"]
    expect(chatHeaders).toBeTypeOf("function")

    const input = {
      sessionID: "ses_native_headers_passthrough",
      agent: "explore",
      model: { providerID: "openai", options: {} }
    } as unknown as Parameters<NonNullable<typeof chatHeaders>>[0]

    const output = { headers: {} as Record<string, string> }
    await chatHeaders?.(input, output)

    expect(output.headers["x-openai-subagent"]).toBeUndefined()
    expect(output.headers["x-opencode-collaboration-mode-kind"]).toBeUndefined()
  })

  it("does not set codex collaboration headers for legacy Orchestrator agent names", async () => {
    const hooks = await CodexAuthPlugin({} as never, { spoofMode: "codex" })
    const chatHeaders = hooks["chat.headers"]
    expect(chatHeaders).toBeTypeOf("function")

    const input = {
      sessionID: "ses_legacy_orchestrator_passthrough",
      agent: "Orchestrator-Plan",
      model: { providerID: "openai", options: {} }
    } as unknown as Parameters<NonNullable<typeof chatHeaders>>[0]

    const output = { headers: {} as Record<string, string> }
    await chatHeaders?.(input, output)

    expect(output.headers["x-openai-subagent"]).toBeUndefined()
    expect(output.headers["x-opencode-collaboration-mode-kind"]).toBeUndefined()
  })
})
