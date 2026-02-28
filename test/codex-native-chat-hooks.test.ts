import { describe, expect, it } from "vitest"

import {
  handleChatMessageHook,
  handleChatParamsHook,
  handleSessionCompactingHook,
  handleTextCompleteHook
} from "../lib/codex-native/chat-hooks"

describe("codex-native chat hooks instruction source order", () => {
  it("prefers cached catalog instructions over model.instructions and default codexInstructions", async () => {
    const modelOptions: Record<string, unknown> = {
      codexCatalogModel: {
        slug: "gpt-5.3-codex",
        model_messages: {
          instructions_template: "{{ unsupported_marker }}"
        }
      },
      codexInstructions: "Default codex-instructions"
    }

    const output = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {
        instructions: "OpenCode Host Instructions"
      }
    }

    await handleChatParamsHook({
      hookInput: {
        model: {
          id: "gpt-5.3-codex",
          api: { id: "gpt-5.3-codex" },
          providerID: "openai",
          instructions: "Model Instructions From GitHub",
          capabilities: { toolcall: true },
          options: modelOptions
        } as any,
        message: {}
      },
      output: output as any,
      lastCatalogModels: [
        {
          slug: "gpt-5.3-codex",
          model_messages: {
            instructions_template: "Cached template instructions"
          }
        }
      ],
      spoofMode: "codex",
      collaborationProfileEnabled: false,
      orchestratorSubagentsEnabled: false
    })

    expect(output.options.instructions).toBe("Cached template instructions")
    expect(modelOptions.codexInstructions).toBe("Cached template instructions")
  })

  it("leaves review subtask agents unchanged", async () => {
    const output = {
      parts: [
        { type: "subtask", command: "review" },
        { type: "subtask", command: "review", agent: "custom-reviewer" }
      ]
    }

    await handleChatMessageHook({
      hookInput: {
        model: { providerID: "openai" },
        sessionID: "ses_review"
      },
      output: output as { parts: unknown[] },
      client: undefined
    })

    expect((output.parts[0] as { agent?: string }).agent).toBeUndefined()
    expect((output.parts[1] as { agent?: string }).agent).toBe("custom-reviewer")
  })

  it("sets compacting prompt and tracks session when latest user message uses OpenAI", async () => {
    const summaryPrefixSessions = new Set<string>()
    const output: { prompt?: string } = {}
    const client = {
      session: {
        messages: async () => ({
          data: [
            {
              info: {
                id: "msg_user",
                role: "user",
                model: { providerID: "openai" }
              }
            }
          ]
        })
      }
    } as never

    await handleSessionCompactingHook({
      enabled: true,
      hookInput: { sessionID: "ses_compact" },
      output,
      client,
      summaryPrefixSessions,
      compactPrompt: "compact now"
    })

    expect(output.prompt).toBe("compact now")
    expect(summaryPrefixSessions.has("ses_compact")).toBe(true)
  })

  it("prefixes compaction summaries and clears session tracking after completion", async () => {
    const summaryPrefixSessions = new Set<string>(["ses_summary"])
    const output = { text: "Summary body" }
    const client = {
      session: {
        messages: async () => ({
          data: [
            {
              info: {
                id: "msg_summary",
                role: "assistant",
                agent: "compaction",
                summary: true,
                model: { providerID: "openai" }
              }
            }
          ]
        })
      }
    } as never

    await handleTextCompleteHook({
      enabled: true,
      hookInput: { sessionID: "ses_summary", messageID: "msg_summary" },
      output,
      client,
      summaryPrefixSessions,
      compactSummaryPrefix: "## Compact Summary"
    })

    expect(output.text.startsWith("## Compact Summary")).toBe(true)
    expect(summaryPrefixSessions.has("ses_summary")).toBe(false)
  })
})
