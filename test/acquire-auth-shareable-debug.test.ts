import { describe, expect, it, vi } from "vitest"

describe("acquire auth shareable debug wiring", () => {
  it("emits rotation events through the shareable debug logger", async () => {
    vi.resetModules()

    const authState: Record<string, unknown> = {
      openai: {
        type: "oauth",
        native: {
          strategy: "sticky",
          accounts: [
            {
              identityKey: "acc_1|user@example.com|plus",
              accountId: "acc_1",
              email: "user@example.com",
              plan: "plus",
              enabled: true,
              access: "at_1",
              refresh: "rt_1",
              expires: Date.now() + 60_000
            }
          ],
          activeIdentityKey: "acc_1|user@example.com|plus"
        }
      }
    }

    vi.doMock("../lib/storage", () => ({
      loadAuthStorage: vi.fn(async () => structuredClone(authState)),
      saveAuthStorage: vi.fn(async (_path: string | undefined, update: (auth: Record<string, unknown>) => unknown) => {
        await update(structuredClone(authState))
        return authState
      }),
      ensureOpenAIOAuthDomain: vi.fn((auth: Record<string, unknown>, mode: "native" | "codex") => {
        const openai = auth.openai as { native?: unknown; codex?: unknown }
        return mode === "native" ? openai.native : openai.codex
      })
    }))

    const { acquireOpenAIAuth, createAcquireOpenAIAuthInputDefaults } = await import("../lib/codex-native/acquire-auth")
    const defaults = createAcquireOpenAIAuthInputDefaults()
    const shareableDebug = {
      enabled: true,
      emitRotationBegin: vi.fn(async () => {}),
      emitRotationDecision: vi.fn(async () => {}),
      emitRotationCandidateSelected: vi.fn(async () => {}),
      emitFetchAttemptRequest: vi.fn(async () => {}),
      emitFetchAttemptResponse: vi.fn(async () => {}),
      emitRetryAfter429: vi.fn(async () => {}),
      emitAuthFailure: vi.fn(async () => {})
    }

    const auth = await acquireOpenAIAuth({
      authMode: "native",
      context: { sessionKey: "ses_trace_1" },
      isSubagentRequest: false,
      stickySessionState: defaults.stickySessionState,
      hybridSessionState: defaults.hybridSessionState,
      seenSessionKeys: new Map<string, number>(),
      persistSessionAffinityState: () => {},
      pidOffsetEnabled: false,
      shareableDebug
    })

    expect(auth.access).toBe("at_1")
    expect(shareableDebug.emitRotationBegin).toHaveBeenCalledWith(
      expect.objectContaining({
        authMode: "native",
        rotationStrategy: "sticky",
        activeIdentityKey: "acc_1|user@example.com|plus",
        sessionKey: "ses_trace_1"
      })
    )
    expect(shareableDebug.emitRotationDecision).toHaveBeenCalled()
    expect(shareableDebug.emitRotationCandidateSelected).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedIdentityKey: "acc_1|user@example.com|plus"
      })
    )
    expect(shareableDebug.emitAuthFailure).not.toHaveBeenCalled()
  })
})
