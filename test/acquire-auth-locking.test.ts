import { describe, expect, it, vi } from "vitest"

describe("acquire auth lock behavior", () => {
  it("ignores stale refresh completion when lease changed", async () => {
    vi.resetModules()

    let authState: Record<string, unknown> = {
      openai: {
        type: "oauth",
        native: {
          accounts: [
            {
              identityKey: "acc_1|user@example.com|plus",
              accountId: "acc_1",
              email: "user@example.com",
              plan: "plus",
              enabled: true,
              refresh: "rt_1",
              expires: 0
            }
          ],
          activeIdentityKey: "acc_1|user@example.com|plus"
        }
      }
    }

    let callCount = 0
    const saveAuthStorage = vi.fn(
      async (
        _path: string | undefined,
        update: (
          auth: Record<string, unknown>
        ) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void
      ) => {
        callCount += 1
        const current = structuredClone(authState)
        const next = await update(current)
        authState = structuredClone((next ?? current) as Record<string, unknown>)

        if (callCount === 1) {
          const domain = ((authState.openai as { native?: { accounts?: Array<Record<string, unknown>> } })?.native ?? {
            accounts: []
          }) as { accounts: Array<Record<string, unknown>> }
          const account = domain.accounts[0]
          if (account) {
            account.refreshLeaseUntil = Number(account.refreshLeaseUntil) + 5_000
            account.refresh = "rt_other"
          }
        }

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
      saveAuthStorage,
      ensureOpenAIOAuthDomain
    }))

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const requestUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url
        if (requestUrl.includes("/oauth/token")) {
          return new Response(
            JSON.stringify({
              access_token: "at_new",
              refresh_token: "rt_new",
              expires_in: 3600
            }),
            {
              status: 200,
              headers: { "content-type": "application/json; charset=utf-8" }
            }
          )
        }
        return new Response("ok", { status: 200 })
      })
    )

    const { acquireOpenAIAuth, createAcquireOpenAIAuthInputDefaults } = await import("../lib/codex-native/acquire-auth")
    const defaults = createAcquireOpenAIAuthInputDefaults()

    await expect(
      acquireOpenAIAuth({
        authMode: "native",
        context: { sessionKey: null },
        isSubagentRequest: false,
        stickySessionState: defaults.stickySessionState,
        hybridSessionState: defaults.hybridSessionState,
        seenSessionKeys: new Map<string, number>(),
        persistSessionAffinityState: () => {},
        pidOffsetEnabled: false
      })
    ).rejects.toMatchObject({ type: "all_accounts_cooling_down" })

    const domain = ((authState.openai as { native?: { accounts?: Array<Record<string, unknown>> } })?.native ?? {
      accounts: []
    }) as { accounts: Array<Record<string, unknown>> }
    const account = domain.accounts[0]
    expect(account?.refresh).toBe("rt_other")
    expect(account?.access).toBeUndefined()
  })

  it("refreshes tokens outside auth storage lock", async () => {
    vi.resetModules()

    let inSaveAuthStorage = false
    let authState: Record<string, unknown> = {
      openai: {
        type: "oauth",
        native: {
          accounts: [
            {
              identityKey: "acc_1|user@example.com|plus",
              accountId: "acc_1",
              email: "user@example.com",
              plan: "plus",
              enabled: true,
              refresh: "rt_1",
              expires: 0
            }
          ],
          activeIdentityKey: "acc_1|user@example.com|plus"
        }
      }
    }

    const saveAuthStorage = vi.fn(
      async (
        _path: string | undefined,
        update: (
          auth: Record<string, unknown>
        ) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void
      ) => {
        inSaveAuthStorage = true
        try {
          const current = structuredClone(authState)
          const next = await update(current)
          authState = structuredClone((next ?? current) as Record<string, unknown>)
          return authState
        } finally {
          inSaveAuthStorage = false
        }
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
      saveAuthStorage,
      ensureOpenAIOAuthDomain
    }))

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const requestUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url
        if (requestUrl.includes("/oauth/token")) {
          expect(inSaveAuthStorage).toBe(false)
          return new Response(
            JSON.stringify({
              access_token: "at_2",
              refresh_token: "rt_2",
              expires_in: 3600
            }),
            {
              status: 200,
              headers: { "content-type": "application/json; charset=utf-8" }
            }
          )
        }
        return new Response("ok", { status: 200 })
      })
    )

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

    expect(auth.access).toBe("at_2")
    expect(saveAuthStorage).toHaveBeenCalled()
  })
})
