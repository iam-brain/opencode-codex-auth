import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllGlobals()
})

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
    const loadAuthStorage = vi.fn(async () => structuredClone(authState))

    vi.doMock("../lib/storage", () => ({
      loadAuthStorage,
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
    const loadAuthStorage = vi.fn(async () => structuredClone(authState))

    vi.doMock("../lib/storage", () => ({
      loadAuthStorage,
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

  it("avoids auth storage writes when selecting a still-valid access token", async () => {
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
              access: "at_1",
              refresh: "rt_1",
              expires: Date.now() + 60_000
            }
          ],
          activeIdentityKey: "acc_1|user@example.com|plus"
        }
      }
    }

    let writes = 0
    const saveAuthStorage = vi.fn(
      async (
        _path: string | undefined,
        update: (
          auth: Record<string, unknown>
        ) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void
      ) => {
        const before = JSON.stringify(authState)
        const current = structuredClone(authState)
        const next = await update(current)
        authState = structuredClone((next ?? current) as Record<string, unknown>)
        const after = JSON.stringify(authState)
        if (before !== after) writes += 1
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
    const loadAuthStorage = vi.fn(async () => structuredClone(authState))

    vi.doMock("../lib/storage", () => ({
      loadAuthStorage,
      saveAuthStorage,
      ensureOpenAIOAuthDomain
    }))

    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

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
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(writes).toBe(0)
  })

  it("fails with missing identity metadata without applying cooldown", async () => {
    vi.resetModules()

    let authState: Record<string, unknown> = {
      openai: {
        type: "oauth",
        native: {
          accounts: [
            {
              email: "user@example.com",
              plan: "plus",
              enabled: true,
              refresh: "rt_1",
              expires: 0
            }
          ]
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
    const loadAuthStorage = vi.fn(async () => structuredClone(authState))

    vi.doMock("../lib/storage", () => ({
      loadAuthStorage,
      saveAuthStorage,
      ensureOpenAIOAuthDomain
    }))

    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

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
    ).rejects.toMatchObject({ type: "missing_account_identity" })

    const domain = ((authState.openai as { native?: { accounts?: Array<Record<string, unknown>> } })?.native ?? {
      accounts: []
    }) as { accounts: Array<Record<string, unknown>> }
    const account = domain.accounts[0]
    expect(account?.cooldownUntil).toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("does not return cached access tokens for candidates missing identity", async () => {
    vi.resetModules()

    const authState: Record<string, unknown> = {
      openai: {
        type: "oauth",
        native: {
          accounts: [
            {
              email: "user@example.com",
              plan: "plus",
              enabled: true,
              access: "at_missing_identity",
              refresh: "rt_1",
              expires: Date.now() + 60_000
            }
          ]
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
        const current = structuredClone(authState)
        const next = await update(current)
        return structuredClone((next ?? current) as Record<string, unknown>)
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
    const loadAuthStorage = vi.fn(async () => structuredClone(authState))

    vi.doMock("../lib/storage", () => ({
      loadAuthStorage,
      saveAuthStorage,
      ensureOpenAIOAuthDomain
    }))

    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

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
    ).rejects.toMatchObject({ type: "missing_account_identity" })

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("treats invalid_token refresh failures as non-terminal and keeps account enabled", async () => {
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
          ]
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
    const loadAuthStorage = vi.fn(async () => structuredClone(authState))

    vi.doMock("../lib/storage", () => ({
      loadAuthStorage,
      saveAuthStorage,
      ensureOpenAIOAuthDomain
    }))

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const requestUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url
        if (requestUrl.includes("/oauth/token")) {
          return new Response(JSON.stringify({ error: "invalid_token" }), {
            status: 400,
            headers: { "content-type": "application/json; charset=utf-8" }
          })
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
    expect(account?.enabled).toBe(true)
    expect(typeof account?.cooldownUntil).toBe("number")
  })

  it("rotates past missing-identity candidate to a later valid account", async () => {
    vi.resetModules()

    let authState: Record<string, unknown> = {
      openai: {
        type: "oauth",
        native: {
          accounts: [
            {
              email: "missing@example.com",
              plan: "plus",
              enabled: true,
              refresh: "rt_missing",
              expires: 0
            },
            {
              identityKey: "acc_2|ok@example.com|plus",
              accountId: "acc_2",
              email: "ok@example.com",
              plan: "plus",
              enabled: true,
              access: "at_2",
              refresh: "rt_2",
              expires: Date.now() + 60_000
            }
          ]
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
    const loadAuthStorage = vi.fn(async () => structuredClone(authState))

    vi.doMock("../lib/storage", () => ({
      loadAuthStorage,
      saveAuthStorage,
      ensureOpenAIOAuthDomain
    }))

    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

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
    expect(auth.identityKey).toBe("acc_2|ok@example.com|plus")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("advances round_robin active identity on valid token selections", async () => {
    vi.resetModules()

    let authState: Record<string, unknown> = {
      openai: {
        type: "oauth",
        native: {
          strategy: "round_robin",
          activeIdentityKey: "acc_1|one@example.com|plus",
          accounts: [
            {
              identityKey: "acc_1|one@example.com|plus",
              accountId: "acc_1",
              email: "one@example.com",
              plan: "plus",
              enabled: true,
              access: "at_1",
              refresh: "rt_1",
              expires: Date.now() + 60_000
            },
            {
              identityKey: "acc_2|two@example.com|plus",
              accountId: "acc_2",
              email: "two@example.com",
              plan: "plus",
              enabled: true,
              access: "at_2",
              refresh: "rt_2",
              expires: Date.now() + 60_000
            }
          ]
        }
      }
    }

    let writes = 0
    const saveAuthStorage = vi.fn(
      async (
        _path: string | undefined,
        update: (
          auth: Record<string, unknown>
        ) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void
      ) => {
        const before = JSON.stringify(authState)
        const current = structuredClone(authState)
        const next = await update(current)
        authState = structuredClone((next ?? current) as Record<string, unknown>)
        const after = JSON.stringify(authState)
        if (before !== after) writes += 1
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
    const loadAuthStorage = vi.fn(async () => structuredClone(authState))

    vi.doMock("../lib/storage", () => ({
      loadAuthStorage,
      saveAuthStorage,
      ensureOpenAIOAuthDomain
    }))

    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const { acquireOpenAIAuth, createAcquireOpenAIAuthInputDefaults } = await import("../lib/codex-native/acquire-auth")
    const defaults = createAcquireOpenAIAuthInputDefaults()

    const first = await acquireOpenAIAuth({
      authMode: "native",
      context: { sessionKey: null },
      isSubagentRequest: false,
      stickySessionState: defaults.stickySessionState,
      hybridSessionState: defaults.hybridSessionState,
      seenSessionKeys: new Map<string, number>(),
      persistSessionAffinityState: () => {},
      pidOffsetEnabled: false,
      configuredRotationStrategy: "round_robin"
    })
    expect(first.access).toBe("at_2")
    expect(
      ((authState.openai as { native?: { activeIdentityKey?: string } }).native?.activeIdentityKey ?? undefined)
    ).toBe("acc_2|two@example.com|plus")

    const second = await acquireOpenAIAuth({
      authMode: "native",
      context: { sessionKey: null },
      isSubagentRequest: false,
      stickySessionState: defaults.stickySessionState,
      hybridSessionState: defaults.hybridSessionState,
      seenSessionKeys: new Map<string, number>(),
      persistSessionAffinityState: () => {},
      pidOffsetEnabled: false,
      configuredRotationStrategy: "round_robin"
    })
    expect(second.access).toBe("at_1")
    expect(
      ((authState.openai as { native?: { activeIdentityKey?: string } }).native?.activeIdentityKey ?? undefined)
    ).toBe("acc_1|one@example.com|plus")
    expect(writes).toBe(2)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("never logs refresh token values in rotation attempt metadata", async () => {
    vi.resetModules()

    const refreshSecret = "rt_secret_should_not_log"
    const authState: Record<string, unknown> = {
      openai: {
        type: "oauth",
        native: {
          accounts: [
            {
              email: "missing@example.com",
              plan: "plus",
              enabled: true,
              refresh: refreshSecret,
              expires: 0
            }
          ]
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
        const current = structuredClone(authState)
        const next = await update(current)
        return structuredClone((next ?? current) as Record<string, unknown>)
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
    const loadAuthStorage = vi.fn(async () => structuredClone(authState))

    vi.doMock("../lib/storage", () => ({
      loadAuthStorage,
      saveAuthStorage,
      ensureOpenAIOAuthDomain
    }))

    const debug = vi.fn()
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

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
        pidOffsetEnabled: false,
        log: { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      })
    ).rejects.toMatchObject({ type: "missing_account_identity" })

    const debugPayload = JSON.stringify(debug.mock.calls)
    expect(debugPayload).not.toContain(refreshSecret)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("does not clear session affinity state for subagent requests", async () => {
    vi.resetModules()

    const authState: Record<string, unknown> = {
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
              access: "at_1",
              refresh: "rt_1",
              expires: Date.now() + 60_000
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
        const current = structuredClone(authState)
        const next = await update(current)
        return structuredClone((next ?? current) as Record<string, unknown>)
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
    const loadAuthStorage = vi.fn(async () => structuredClone(authState))

    vi.doMock("../lib/storage", () => ({
      loadAuthStorage,
      saveAuthStorage,
      ensureOpenAIOAuthDomain
    }))

    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const { acquireOpenAIAuth, createAcquireOpenAIAuthInputDefaults } = await import("../lib/codex-native/acquire-auth")
    const defaults = createAcquireOpenAIAuthInputDefaults()
    defaults.stickySessionState.bySessionKey.set("ses_parent", "acc_1|user@example.com|plus")
    defaults.stickySessionState.bySessionKey.set("ses_subagent", "acc_1|user@example.com|plus")
    defaults.hybridSessionState.bySessionKey.set("ses_parent", "acc_1|user@example.com|plus")
    defaults.hybridSessionState.bySessionKey.set("ses_subagent", "acc_1|user@example.com|plus")
    const seenSessionKeys = new Map<string, number>([
      ["ses_parent", 111],
      ["ses_subagent", 222]
    ])

    const auth = await acquireOpenAIAuth({
      authMode: "native",
      context: { sessionKey: "ses_subagent" },
      isSubagentRequest: true,
      stickySessionState: defaults.stickySessionState,
      hybridSessionState: defaults.hybridSessionState,
      seenSessionKeys,
      persistSessionAffinityState: () => {},
      pidOffsetEnabled: false
    })

    expect(auth.access).toBe("at_1")
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(seenSessionKeys.get("ses_parent")).toBe(111)
    expect(seenSessionKeys.get("ses_subagent")).toBe(222)
    expect(defaults.stickySessionState.bySessionKey.get("ses_parent")).toBe("acc_1|user@example.com|plus")
    expect(defaults.stickySessionState.bySessionKey.get("ses_subagent")).toBe("acc_1|user@example.com|plus")
    expect(defaults.hybridSessionState.bySessionKey.get("ses_parent")).toBe("acc_1|user@example.com|plus")
    expect(defaults.hybridSessionState.bySessionKey.get("ses_subagent")).toBe("acc_1|user@example.com|plus")
  })
})
