import { describe, expect, it } from "vitest"

import { CodexAuthPlugin } from "../lib/codex-native"

describe("codex-native compaction hook", () => {
  it("swaps to codex compact prompt for openai sessions", async () => {
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
      } as never
    )

    const compacting = hooks["experimental.session.compacting"]
    expect(compacting).toBeTypeOf("function")

    const output: { context: string[]; prompt?: string } = { context: [], prompt: undefined }
    await compacting?.({ sessionID: "ses_openai_compact" }, output)

    expect(output.prompt).toContain("CONTEXT CHECKPOINT COMPACTION")
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
      } as never
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
      } as never
    )

    const compacting = hooks["experimental.session.compacting"]
    expect(compacting).toBeTypeOf("function")

    const output: { context: string[]; prompt?: string } = { context: [], prompt: undefined }
    await compacting?.({ sessionID: "ses_lookup_error_compact" }, output)

    expect(output.prompt).toBeUndefined()
  })
})
