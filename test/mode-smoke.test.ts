import { describe, expect, it } from "vitest"
import { CodexAuthPlugin } from "../lib/codex-native"

describe("mode smoke: native vs codex", () => {
  it("compares chat.headers in both modes", async () => {
    const input = {
      sessionID: "ses_mode_smoke",
      model: {
        providerID: "openai",
        options: { promptCacheKey: "ses_mode_smoke_prompt" }
      }
    } as any

    const nativeHooks = await CodexAuthPlugin({} as never, { spoofMode: "native", headerSnapshots: true })
    const codexHooks = await CodexAuthPlugin({} as never, { spoofMode: "codex", headerSnapshots: true })

    const nativeOut = { headers: {} as Record<string, string> }
    const codexOut = { headers: {} as Record<string, string> }

    await nativeHooks["chat.headers"]?.(input, nativeOut as any)
    await codexHooks["chat.headers"]?.(input, codexOut as any)

    expect(nativeOut.headers.originator).toBe("opencode")
    expect(codexOut.headers.originator).toBeTruthy()
    expect(nativeOut.headers["OpenAI-Beta"]).toBeUndefined()
    expect(codexOut.headers["OpenAI-Beta"]).toBeUndefined()
    expect(nativeOut.headers["session_id"]).toBe("ses_mode_smoke")
    expect(nativeOut.headers["conversation_id"]).toBeUndefined()
    expect(codexOut.headers["conversation_id"]).toBeUndefined()
    expect(nativeOut.headers["User-Agent"]).toMatch(/^opencode\//)
    expect(codexOut.headers["User-Agent"]).toMatch(/^codex_cli_rs\//)
  })

  it("compares chat.params behavior in both modes", async () => {
    const input = {
      sessionID: "ses_mode_smoke",
      agent: "default",
      provider: {},
      message: {},
      model: {
        providerID: "openai",
        capabilities: { toolcall: true },
        options: {
          codexInstructions: "Catalog Codex Instructions",
          codexRuntimeDefaults: {
            defaultReasoningEffort: "high",
            supportsReasoningSummaries: true,
            reasoningSummaryFormat: "experimental",
            defaultVerbosity: "medium"
          }
        }
      }
    } as any

    const withHost = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {
        instructions: "OpenCode Host Instructions",
        include: ["web_search_call.action.sources"]
      }
    }

    const withoutHost = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {
        include: ["web_search_call.action.sources"]
      }
    }

    const nativeHooks = await CodexAuthPlugin({} as never, { spoofMode: "native" })
    const codexHooks = await CodexAuthPlugin({} as never, { spoofMode: "codex" })

    const nativeWithHost = structuredClone(withHost)
    const codexWithHost = structuredClone(withHost)
    await nativeHooks["chat.params"]?.(input, nativeWithHost as any)
    await codexHooks["chat.params"]?.(input, codexWithHost as any)

    const nativeNoHost = structuredClone(withoutHost)
    const codexNoHost = structuredClone(withoutHost)
    await nativeHooks["chat.params"]?.(input, nativeNoHost as any)
    await codexHooks["chat.params"]?.(input, codexNoHost as any)

    expect(nativeWithHost.options.instructions).toBe("OpenCode Host Instructions")
    expect(codexWithHost.options.instructions).toBe("Catalog Codex Instructions")
    expect(nativeNoHost.options.instructions).toBe("Catalog Codex Instructions")
    expect(codexNoHost.options.instructions).toBe("Catalog Codex Instructions")
    expect(nativeNoHost.options.reasoningSummary).toBe("experimental")
    expect(codexNoHost.options.reasoningSummary).toBe("experimental")
    expect(nativeNoHost.options.textVerbosity).toBe("medium")
    expect(codexNoHost.options.textVerbosity).toBe("medium")
  })

  it("falls back to model.instructions for codex replacement when options are missing catalog fields", async () => {
    const input = {
      sessionID: "ses_mode_smoke_fallback",
      agent: "default",
      provider: {},
      message: {},
      model: {
        providerID: "openai",
        instructions: "Catalog Instructions From Model",
        capabilities: { toolcall: true },
        options: {}
      }
    } as any

    const withHost = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {
        instructions: "OpenCode Host Instructions",
        include: ["web_search_call.action.sources"]
      }
    }

    const nativeHooks = await CodexAuthPlugin({} as never, { spoofMode: "native" })
    const codexHooks = await CodexAuthPlugin({} as never, { spoofMode: "codex" })

    const nativeOut = structuredClone(withHost)
    const codexOut = structuredClone(withHost)
    await nativeHooks["chat.params"]?.(input, nativeOut as any)
    await codexHooks["chat.params"]?.(input, codexOut as any)

    expect(nativeOut.options.instructions).toBe("OpenCode Host Instructions")
    expect(codexOut.options.instructions).toBe("Catalog Instructions From Model")
  })
})
