import { describe, expect, it } from "vitest"

import { CodexAuthPlugin } from "../lib/codex-native"

describe("codex-native parallel tool-call defaults", () => {
  it("prefers catalog parallel tool-call defaults over generic tool-call capability", async () => {
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
            supportsParallelToolCalls: false
          }
        }
      }
    } as unknown as Parameters<NonNullable<typeof chatParams>>[0]

    const output: any = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {}
    }

    await chatParams?.(input, output)
    expect(output.options.parallelToolCalls).toBe(false)
  })
})
