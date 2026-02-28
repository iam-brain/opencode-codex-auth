import { describe, expect, it } from "vitest"

import {
  getMessageProviderID,
  readSessionMessageInfo,
  readSessionMessageRows,
  sessionUsesOpenAIProvider
} from "../lib/codex-native/session-messages.js"

describe("session-messages helpers", () => {
  it("returns [] when session API is unavailable or throws", async () => {
    await expect(readSessionMessageRows(undefined, "ses_missing")).resolves.toEqual([])

    const client = {
      session: {
        messages: async () => {
          throw new Error("boom")
        }
      }
    } as never

    await expect(readSessionMessageRows(client, "ses_error")).resolves.toEqual([])
  })

  it("infers OpenAI provider from latest user message", async () => {
    const client = {
      session: {
        messages: async () => ({
          data: [
            { info: { role: "user", model: { providerID: "other" } } },
            { info: { role: "user", model: { providerID: "openai" } } }
          ]
        })
      }
    } as never

    await expect(sessionUsesOpenAIProvider(client, "ses_provider")).resolves.toBe(true)
  })

  it("reads specific message info rows and provider id fallbacks", async () => {
    const client = {
      session: {
        messages: async () => ({
          data: [
            { info: { id: "m1", role: "assistant", providerID: "openai" } },
            { info: { id: "m2", role: "assistant", model: { providerID: "openai" } } }
          ]
        })
      }
    } as never

    const info = await readSessionMessageInfo(client, "ses_lookup", "m2")
    expect(info).toBeDefined()
    if (!info) throw new Error("missing info")
    expect(getMessageProviderID(info)).toBe("openai")
    await expect(readSessionMessageInfo(client, "ses_lookup", "missing")).resolves.toBeUndefined()
  })
})
