import { describe, expect, it } from "vitest"

import { CodexAuthPlugin } from "../lib/codex-native"

describe("opencode compatibility", () => {
  it("falls back to safe base instructions when catalog template contains stale tool markers", async () => {
    const hooks = await CodexAuthPlugin({} as never)
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_compat_guard",
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
            base_instructions: "Safe base instructions",
            model_messages: {
              instructions_template: "Use multi_tool_use.parallel with recipient_name=functions.exec_command"
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
    expect(output.options.instructions).toBe("Safe base instructions")
  })

  it("keeps include entries unique while preserving host-provided values", async () => {
    const hooks = await CodexAuthPlugin({} as never)
    const chatParams = hooks["chat.params"]
    expect(chatParams).toBeTypeOf("function")

    const input = {
      sessionID: "ses_compat_include",
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
      options: {
        include: ["web_search_call.action.sources", "reasoning.encrypted_content", "reasoning.encrypted_content"]
      }
    }

    await chatParams?.(input, output)
    expect(output.options.include).toEqual(["web_search_call.action.sources", "reasoning.encrypted_content"])
  })
})
