import { describe, expect, it } from "vitest"

import { CodexAuthPlugin } from "../lib/codex-native"

describe("codex-native compaction hook", () => {
  it("defaults compaction override on in codex mode", async () => {
    const hooks = await CodexAuthPlugin(
      {
        client: {
          session: {
            messages: async () => ({
              data: [
                { info: { role: "assistant", providerID: "openai", modelID: "gpt-5.3-codex" } },
                { info: { role: "user", model: { providerID: "openai", modelID: "gpt-5.3-codex" } } }
              ]
            })
          }
        }
      } as never,
      { mode: "codex" }
    )

    const compacting = hooks["experimental.session.compacting"]
    expect(compacting).toBeTypeOf("function")

    const output: { context: string[]; prompt?: string } = { context: [], prompt: undefined }
    await compacting?.({ sessionID: "ses_openai_compact" }, output)

    expect(output.prompt).toContain("CONTEXT CHECKPOINT COMPACTION")
  })

  it("allows compaction override in native mode when explicitly enabled", async () => {
    const hooks = await CodexAuthPlugin(
      {
        client: {
          session: {
            messages: async () => ({
              data: [
                { info: { role: "assistant", providerID: "openai", modelID: "gpt-5.3-codex" } },
                { info: { role: "user", model: { providerID: "openai", modelID: "gpt-5.3-codex" } } }
              ]
            })
          }
        }
      } as never,
      { mode: "native", codexCompactionOverride: true }
    )

    const compacting = hooks["experimental.session.compacting"]
    expect(compacting).toBeTypeOf("function")

    const output: { context: string[]; prompt?: string } = { context: [], prompt: undefined }
    await compacting?.({ sessionID: "ses_openai_compact_native_mode" }, output)

    expect(output.prompt).toContain("CONTEXT CHECKPOINT COMPACTION")
  })

  it("does not swap compaction prompt in codex mode when override is explicitly disabled", async () => {
    const hooks = await CodexAuthPlugin(
      {
        client: {
          session: {
            messages: async () => ({
              data: [
                { info: { role: "assistant", providerID: "openai", modelID: "gpt-5.3-codex" } },
                { info: { role: "user", model: { providerID: "openai", modelID: "gpt-5.3-codex" } } }
              ]
            })
          }
        }
      } as never,
      { mode: "codex", codexCompactionOverride: false }
    )

    const compacting = hooks["experimental.session.compacting"]
    expect(compacting).toBeTypeOf("function")

    const output: { context: string[]; prompt?: string } = { context: [], prompt: undefined }
    await compacting?.({ sessionID: "ses_openai_compact_codex_no_override" }, output)

    expect(output.prompt).toBeUndefined()
  })

  it("leaves compaction prompt unchanged for non-openai sessions", async () => {
    const hooks = await CodexAuthPlugin(
      {
        client: {
          session: {
            messages: async () => ({
              data: [
                {
                  info: {
                    role: "user",
                    model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" }
                  }
                }
              ]
            })
          }
        }
      } as never,
      { mode: "codex", codexCompactionOverride: true }
    )

    const compacting = hooks["experimental.session.compacting"]
    expect(compacting).toBeTypeOf("function")

    const output: { context: string[]; prompt?: string } = { context: [], prompt: undefined }
    await compacting?.({ sessionID: "ses_non_openai_compact" }, output)

    expect(output.prompt).toBeUndefined()
  })

  it("fails open when session lookup errors", async () => {
    const hooks = await CodexAuthPlugin(
      {
        client: {
          session: {
            messages: async () => {
              throw new Error("session lookup failed")
            }
          }
        }
      } as never,
      { mode: "codex", codexCompactionOverride: true }
    )

    const compacting = hooks["experimental.session.compacting"]
    expect(compacting).toBeTypeOf("function")

    const output: { context: string[]; prompt?: string } = { context: [], prompt: undefined }
    await compacting?.({ sessionID: "ses_lookup_error_compact" }, output)

    expect(output.prompt).toBeUndefined()
  })

  it("prefixes openai compaction summaries with codex resume context", async () => {
    const hooks = await CodexAuthPlugin(
      {
        client: {
          session: {
            messages: async () => ({
              data: [
                {
                  info: {
                    id: "msg_compaction_summary",
                    role: "assistant",
                    agent: "compaction",
                    summary: true,
                    providerID: "openai"
                  }
                },
                {
                  info: {
                    id: "msg_user",
                    role: "user",
                    model: { providerID: "openai", modelID: "gpt-5.3-codex" }
                  }
                }
              ]
            })
          }
        }
      } as never,
      { mode: "codex", codexCompactionOverride: true }
    )

    const compacting = hooks["experimental.session.compacting"]
    const complete = hooks["experimental.text.complete"]
    expect(compacting).toBeTypeOf("function")
    expect(complete).toBeTypeOf("function")

    const compactingOutput: { context: string[]; prompt?: string } = { context: [], prompt: undefined }
    await compacting?.({ sessionID: "ses_openai_compaction_summary" }, compactingOutput)

    const output = { text: "Progress captured for handoff." }
    await complete?.(
      {
        sessionID: "ses_openai_compaction_summary",
        messageID: "msg_compaction_summary",
        partID: "part_summary"
      },
      output
    )

    expect(output.text).toContain("Another language model started to solve this problem")
    expect(output.text).toContain("Progress captured for handoff.")
  })

  it("does not prefix text when compaction was not activated", async () => {
    const hooks = await CodexAuthPlugin(
      {
        client: {
          session: {
            messages: async () => ({
              data: [
                {
                  info: {
                    id: "msg_compaction_summary",
                    role: "assistant",
                    agent: "compaction",
                    summary: true,
                    providerID: "openai"
                  }
                },
                {
                  info: {
                    id: "msg_user",
                    role: "user",
                    model: { providerID: "openai", modelID: "gpt-5.3-codex" }
                  }
                }
              ]
            })
          }
        }
      } as never,
      { mode: "codex", codexCompactionOverride: true }
    )

    const complete = hooks["experimental.text.complete"]
    expect(complete).toBeTypeOf("function")

    const output = { text: "No prefix expected." }
    await complete?.(
      {
        sessionID: "ses_no_compact_hook",
        messageID: "msg_compaction_summary",
        partID: "part_summary"
      },
      output
    )

    expect(output.text).toBe("No prefix expected.")
  })
})
