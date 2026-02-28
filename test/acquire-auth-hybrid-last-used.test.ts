import { describe, expect, it, vi } from "vitest"

describe("acquire auth hybrid lastUsed persistence", () => {
  it("updates lastUsed for hybrid strategy when serving a still-valid access token", async () => {
    vi.resetModules()
    vi.spyOn(Date, "now").mockReturnValue(100_000)

    let authState: Record<string, unknown> = {
      openai: {
        type: "oauth",
        native: {
          strategy: "hybrid",
          accounts: [
            {
              identityKey: "acc_1|user@example.com|plus",
              accountId: "acc_1",
              email: "user@example.com",
              plan: "plus",
              enabled: true,
              access: "at_1",
              refresh: "rt_1",
              expires: 160_000,
              lastUsed: 0
            }
          ],
          activeIdentityKey: "acc_1|user@example.com|plus"
        }
      }
    }

    const loadAuthStorage = vi.fn(async () => structuredClone(authState))
    const saveAuthStorage = vi.fn(
      async (
        _path: string | undefined,
        update: (
          auth: Record<string, unknown>
        ) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void
      ) => {
        const current = structuredClone(authState)
        const next = await update(current)
        authState = structuredClone((next ?? current) as Record<string, unknown>)
        return authState
      }
    )

    const ensureOpenAIOAuthDomain = vi.fn((auth: Record<string, unknown>, mode: "native" | "codex") => {
      const openai = auth.openai as { type?: string; native?: { accounts: unknown[] }; codex?: { accounts: unknown[] } }
      if (!openai || openai.type !== "oauth") {
        throw new Error("OpenAI OAuth not configured")
      }
      const existing = mode === "native" ? openai.native : openai.codex
      if (existing) return existing
      const created = { accounts: [] as unknown[] }
      if (mode === "native") openai.native = created
      else openai.codex = created
      return created
    })

    vi.doMock("../lib/storage", () => ({
      loadAuthStorage,
      saveAuthStorage,
      ensureOpenAIOAuthDomain
    }))

    const { acquireOpenAIAuth, createAcquireOpenAIAuthInputDefaults } = await import("../lib/codex-native/acquire-auth")
    const defaults = createAcquireOpenAIAuthInputDefaults()

    const auth = await acquireOpenAIAuth({
      authMode: "native",
      context: { sessionKey: null },
      isSubagentRequest: false,
      stickySessionState: defaults.stickySessionState,
      hybridSessionState: defaults.hybridSessionState,
      seenSessionKeys: new Map<string, number>(),
      persistSessionAffinityState: () => {},
      pidOffsetEnabled: false
    })

    expect(auth.access).toBe("at_1")
    expect(saveAuthStorage).toHaveBeenCalledTimes(1)
    const domain = (authState.openai as { native?: { accounts?: Array<Record<string, unknown>> } }).native
    expect(domain?.accounts?.[0]?.lastUsed).toBe(100_000)
  })
})
