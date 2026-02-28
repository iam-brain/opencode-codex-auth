import { describe, expect, it } from "vitest"

import { CodexAuthPlugin } from "../lib/codex-native"

describe("codex-native review hotswap", () => {
  it("preserves review subtask agent for OpenAI provider models", async () => {
    const hooks = await CodexAuthPlugin({} as never)
    const chatMessage = hooks["chat.message"]
    expect(chatMessage).toBeTypeOf("function")

    const input = {
      sessionID: "ses_review_swap_openai",
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5.3-codex" }
    } as unknown as Parameters<NonNullable<typeof chatMessage>>[0]

    const output: any = {
      message: {
        id: "msg_review_swap",
        sessionID: "ses_review_swap_openai",
        role: "user" as const,
        time: { created: Date.now() },
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-5.3-codex" }
      },
      parts: [
        {
          id: "part_review_subtask",
          sessionID: "ses_review_swap_openai",
          messageID: "msg_review_swap",
          type: "subtask",
          prompt: "review these changes",
          description: "review",
          agent: "general",
          command: "review",
          model: { providerID: "openai", modelID: "gpt-5.3-codex" }
        }
      ]
    }

    await chatMessage?.(input, output)
    expect((output.parts[0] as { agent?: string }).agent).toBe("general")
  })

  it("does not rewrite non-review subtasks", async () => {
    const hooks = await CodexAuthPlugin({} as never)
    const chatMessage = hooks["chat.message"]
    expect(chatMessage).toBeTypeOf("function")

    const input = {
      sessionID: "ses_non_review_subtask",
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5.3-codex" }
    } as unknown as Parameters<NonNullable<typeof chatMessage>>[0]

    const output: any = {
      message: {
        id: "msg_non_review_subtask",
        sessionID: "ses_non_review_subtask",
        role: "user" as const,
        time: { created: Date.now() },
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-5.3-codex" }
      },
      parts: [
        {
          id: "part_non_review_subtask",
          sessionID: "ses_non_review_subtask",
          messageID: "msg_non_review_subtask",
          type: "subtask",
          prompt: "run setup",
          description: "init",
          agent: "general",
          command: "init",
          model: { providerID: "openai", modelID: "gpt-5.3-codex" }
        }
      ]
    }

    await chatMessage?.(input, output)
    expect((output.parts[0] as { agent?: string }).agent).toBe("general")
  })

  it("does not rewrite review subtasks for non-openai provider models", async () => {
    const hooks = await CodexAuthPlugin({} as never)
    const chatMessage = hooks["chat.message"]
    expect(chatMessage).toBeTypeOf("function")

    const input = {
      sessionID: "ses_review_non_openai",
      agent: "build",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" }
    } as unknown as Parameters<NonNullable<typeof chatMessage>>[0]

    const output: any = {
      message: {
        id: "msg_review_non_openai",
        sessionID: "ses_review_non_openai",
        role: "user" as const,
        time: { created: Date.now() },
        agent: "build",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" }
      },
      parts: [
        {
          id: "part_review_non_openai",
          sessionID: "ses_review_non_openai",
          messageID: "msg_review_non_openai",
          type: "subtask",
          prompt: "review these changes",
          description: "review",
          agent: "general",
          command: "review",
          model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" }
        }
      ]
    }

    await chatMessage?.(input, output)
    expect((output.parts[0] as { agent?: string }).agent).toBe("general")
  })

  it("preserves review subtask agent when model is absent and provider is inferred", async () => {
    const hooks = await CodexAuthPlugin({
      client: {
        session: {
          messages: async () => ({
            data: [
              {
                info: {
                  role: "user",
                  model: { providerID: "openai", modelID: "gpt-5.3-codex" }
                }
              }
            ]
          })
        }
      }
    } as never)
    const chatMessage = hooks["chat.message"]
    expect(chatMessage).toBeTypeOf("function")

    const input = {
      sessionID: "ses_review_lookup_openai",
      agent: "build"
    } as unknown as Parameters<NonNullable<typeof chatMessage>>[0]

    const output: any = {
      message: {
        id: "msg_review_lookup_openai",
        sessionID: "ses_review_lookup_openai",
        role: "user" as const,
        time: { created: Date.now() },
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-5.3-codex" }
      },
      parts: [
        {
          id: "part_review_lookup_openai",
          sessionID: "ses_review_lookup_openai",
          messageID: "msg_review_lookup_openai",
          type: "subtask",
          prompt: "review these changes",
          description: "review",
          agent: "general",
          command: "review",
          model: { providerID: "openai", modelID: "gpt-5.3-codex" }
        }
      ]
    }

    await chatMessage?.(input, output)
    expect((output.parts[0] as { agent?: string }).agent).toBe("general")
  })
})
