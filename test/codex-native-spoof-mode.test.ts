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
    expect(output.options.include).toEqual(["web_search_call.action.sources", "reasoning.encrypted_content"])
  })

  it("applies model reasoning summary format default verbatim", async () => {
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
          codexRuntimeDefaults: {
            defaultReasoningEffort: "high",
            supportsReasoningSummaries: true,
            reasoningSummaryFormat: "experimental"
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
    expect(output.options.reasoningSummary).toBe("experimental")
  })

  it("treats model reasoning summary format none as disabled", async () => {
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
          codexRuntimeDefaults: {
            defaultReasoningEffort: "high",
            supportsReasoningSummaries: true,
            reasoningSummaryFormat: "none"
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
    expect(output.options.reasoningSummary).toBeUndefined()
  })

  it("keeps explicit host options in native chat.params", async () => {
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
    expect(output.options.reasoningSummary).toBeUndefined()
    expect(output.options.textVerbosity).toBe("high")
    expect(output.options.parallelToolCalls).toBe(false)
    expect(output.options.include).toEqual(["reasoning.encrypted_content"])
  })

  it("replaces host instructions with codex instructions in codex mode", async () => {
    const hooks = await CodexAuthPlugin({} as never, { spoofMode: "codex" })
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

    expect(output.options.instructions).toBe("Catalog instructions")
    expect(output.options.reasoningEffort).toBe("minimal")
    expect(output.options.reasoningSummary).toBeUndefined()
    expect(output.options.textVerbosity).toBe("high")
    expect(output.options.parallelToolCalls).toBe(false)
    expect(output.options.include).toEqual(["reasoning.encrypted_content"])
  })

  it("re-renders catalog instructions with configured personality in codex mode even when host instructions are set", async () => {
    const hooks = await CodexAuthPlugin({} as never, {
      spoofMode: "codex",
      behaviorSettings: {
        global: { personality: "codex_mode_regression_voice_123" }
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
                personalities: {
                  codex_mode_regression_voice_123: "Regression voice"
                }
              }
            }
          },
          codexInstructions: "Catalog fallback instructions"
        }
      }
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const output = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {
        instructions: "Host instructions"
      }
    }

    await chatParams?.(input, output)
    expect(output.options.instructions).toBe("Base Regression voice")
  })

  it("applies global behavior settings personality in chat.params", async () => {
    const hooks = await CodexAuthPlugin({} as never, {
      behaviorSettings: {
        global: { personality: "friendly" }
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

  it("applies per-model behavior settings personality override", async () => {
    const hooks = await CodexAuthPlugin({} as never, {
      behaviorSettings: {
        global: { personality: "friendly" },
        perModel: {
          "gpt-5.3-codex": {
            personality: "pragmatic"
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
      behaviorSettings: {
        global: { personality: "friendly" },
        perModel: {
          "gpt-5.3-codex": {
            personality: "pragmatic",
            variants: {
              high: { personality: "strict" }
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
      behaviorSettings: {
        global: {
          thinkingSummaries: false
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
    expect(output.options.reasoningSummary).toBeUndefined()
  })

  it("prefers per-model thinking summaries over global setting", async () => {
    const hooks = await CodexAuthPlugin({} as never, {
      behaviorSettings: {
        global: {
          thinkingSummaries: true
        },
        perModel: {
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
    expect(output.options.reasoningSummary).toBeUndefined()
  })

  it("prefers per-variant thinking summaries over per-model and global", async () => {
    const hooks = await CodexAuthPlugin({} as never, {
      behaviorSettings: {
        global: {
          thinkingSummaries: false
        },
        perModel: {
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

  it("applies global verbosity override when enabled", async () => {
    const hooks = await CodexAuthPlugin({} as never, {
      behaviorSettings: {
        global: {
          verbosityEnabled: true,
          verbosity: "high"
        }
      }
    })
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_verbosity_global",
      agent: "default",
      provider: {},
      message: {},
      model: {
        id: "gpt-5.3-codex",
        api: { id: "gpt-5.3-codex" },
        providerID: "openai",
        capabilities: { toolcall: true },
        options: {
          codexRuntimeDefaults: {
            supportsVerbosity: true,
            defaultVerbosity: "medium"
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
    expect(output.options.textVerbosity).toBe("high")
  })

  it("ignores verbosity settings when the model reports no verbosity support", async () => {
    const hooks = await CodexAuthPlugin({} as never, {
      behaviorSettings: {
        global: {
          verbosityEnabled: true,
          verbosity: "high"
        }
      }
    })
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_verbosity_unsupported",
      agent: "default",
      provider: {},
      message: {},
      model: {
        id: "gpt-5.3-codex",
        api: { id: "gpt-5.3-codex" },
        providerID: "openai",
        capabilities: { toolcall: true },
        options: {
          codexRuntimeDefaults: {
            supportsVerbosity: false,
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
        textVerbosity: "high"
      }
    }

    await chatParams?.(input, output)
    expect(output.options.textVerbosity).toBeUndefined()
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
              instructions_template: "Use multi_tool_use.parallel with recipient_name=functions.read"
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

  it("injects collaboration instructions for Codex agents by default in codex mode", async () => {
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
    expect(output.options.instructions).toContain("Catalog instructions")
    expect(output.options.instructions).toContain("# Plan Mode (Conversational)")
    expect(output.options.instructions).toContain("Tooling Compatibility (OpenCode)")
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

    expect(output.headers.originator).toBe("opencode")
    expect(output.headers["User-Agent"]).toMatch(/^opencode\//)
    expect(output.headers.session_id).toBe("ses_native")
    expect(output.headers.conversation_id).toBeUndefined()
    expect(output.headers["OpenAI-Beta"]).toBeUndefined()
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

    expect(output.headers.originator).toBe("opencode")
    expect(output.headers["User-Agent"]).toMatch(/^opencode\//)
    expect(output.headers.session_id).toBe("ses_no_prompt_cache")
    expect(output.headers.conversation_id).toBeUndefined()
    expect(output.headers["OpenAI-Beta"]).toBeUndefined()
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
    expect(output.headers.session_id).toBe("ses_strict")
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

  it("sets collaboration headers for Codex agents by default in codex mode", async () => {
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

    expect(output.headers["x-openai-subagent"]).toBe("review")
    expect(output.headers["x-opencode-collaboration-mode-kind"]).toBe("code")
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

  it("allows collaboration injection in native mode when explicitly enabled", async () => {
    const hooks = await CodexAuthPlugin(
      {} as never,
      {
        spoofMode: "native",
        mode: "native",
        collaborationProfileEnabled: true,
        orchestratorSubagentsEnabled: true,
        collaborationToolProfile: "codex"
      } as never
    )
    const chatParams = hooks["chat.params"]
    const chatHeaders = hooks["chat.headers"]
    expect(chatParams).toBeTypeOf("function")
    expect(chatHeaders).toBeTypeOf("function")

    const paramsInput = {
      sessionID: "ses_native_collab_params",
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
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const paramsOutput = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {}
    }

    await chatParams?.(paramsInput, paramsOutput)
    expect(paramsOutput.options.instructions).toContain("Catalog instructions")
    expect(paramsOutput.options.instructions).toContain("# Sub-agents")
    expect(paramsOutput.options.instructions).toContain("Tooling Compatibility (Codex-style)")

    const headersInput = {
      sessionID: "ses_native_collab_headers",
      agent: "Codex Review",
      model: { providerID: "openai", options: {} }
    } as unknown as Parameters<NonNullable<typeof chatHeaders>>[0]

    const headersOutput = { headers: {} as Record<string, string> }
    await chatHeaders?.(headersInput, headersOutput)
    expect(headersOutput.headers["x-opencode-collaboration-mode-kind"]).toBe("code")
    expect(headersOutput.headers["x-openai-subagent"]).toBe("review")
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

  it("injects plan-mode collaboration instructions when experimental collaboration profile is enabled", async () => {
    const hooks = await CodexAuthPlugin(
      {} as never,
      {
        spoofMode: "codex",
        mode: "codex",
        collaborationProfileEnabled: true
      } as never
    )
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_plan_collab_enabled",
      agent: "plan",
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
    expect(output.options.instructions).toContain("# Plan Mode (Conversational)")
  })

  it("injects orchestrator collaboration instructions when experimental collaboration profile is enabled", async () => {
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

    const input = {
      sessionID: "ses_orchestrator_collab_enabled",
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
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const output = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {}
    }

    await chatParams?.(input, output)

    expect(output.options.instructions).toContain("Catalog instructions")
    expect(output.options.instructions).toContain("# Sub-agents")
  })

  it("preserves orchestrator instructions instead of replacing with model base instructions", async () => {
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

    const input = {
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
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const output = {
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

    await chatParams?.(input, output)

    expect(output.options.instructions).toContain("You are Codex, a coding agent based on GPT-5.")
    expect(output.options.instructions).toContain("# Sub-agents")
    expect(output.options.instructions).toContain("Tooling Compatibility (OpenCode)")
    expect(output.options.instructions).not.toContain("Catalog instructions")
  })

  it("sets collaboration-mode header for plan agent when experimental collaboration profile is enabled", async () => {
    const hooks = await CodexAuthPlugin(
      {} as never,
      {
        spoofMode: "codex",
        mode: "codex",
        collaborationProfileEnabled: true
      } as never
    )
    const chatHeaders = hooks["chat.headers"]
    expect(chatHeaders).toBeTypeOf("function")

    const input = {
      sessionID: "ses_plan_collab_headers",
      agent: "plan",
      model: { providerID: "openai", options: {} }
    } as unknown as Parameters<NonNullable<typeof chatHeaders>>[0]

    const output = { headers: {} as Record<string, string> }
    await chatHeaders?.(input, output)

    expect(output.headers["x-opencode-collaboration-mode-kind"]).toBe("plan")
    expect(output.headers["x-openai-subagent"]).toBeUndefined()
  })

  it("sets subagent + collaboration headers for codex review helper when orchestrator subagents are enabled", async () => {
    const hooks = await CodexAuthPlugin(
      {} as never,
      {
        spoofMode: "codex",
        mode: "codex",
        collaborationProfileEnabled: true,
        orchestratorSubagentsEnabled: true
      } as never
    )
    const chatHeaders = hooks["chat.headers"]
    expect(chatHeaders).toBeTypeOf("function")

    const input = {
      sessionID: "ses_review_collab_headers",
      agent: "Codex Review",
      model: { providerID: "openai", options: {} }
    } as unknown as Parameters<NonNullable<typeof chatHeaders>>[0]

    const output = { headers: {} as Record<string, string> }
    await chatHeaders?.(input, output)

    expect(output.headers["x-opencode-collaboration-mode-kind"]).toBe("code")
    expect(output.headers["x-openai-subagent"]).toBe("review")
  })
})
