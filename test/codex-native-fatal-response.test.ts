import { afterEach, describe, expect, it, vi } from "vitest"

type MockAuthFile = {
  openai?: {
    type: "oauth"
    strategy?: "round_robin" | "sticky" | "hybrid"
    activeIdentityKey?: string
    accounts: Array<{
      identityKey?: string
      accountId?: string
      email?: string
      plan?: string
      authTypes?: Array<"native" | "codex">
      enabled?: boolean
      access?: string
      refresh?: string
      expires?: number
      cooldownUntil?: number
      lastUsed?: number
    }>
  }
}

async function loadPluginForAuth(
  authFile: MockAuthFile,
  getAuthResult: { type: "oauth" | "api"; refresh?: string; access?: string; expires?: number; key?: string } = {
    type: "oauth",
    refresh: "",
    access: "",
    expires: 0
  }
) {
  vi.resetModules()

  const loadAuthStorage = vi.fn(async () => structuredClone(authFile))
  const saveAuthStorage = vi.fn(
    async (
      _path: string | undefined,
      update: (auth: MockAuthFile) => Promise<MockAuthFile | void> | MockAuthFile | void
    ) => {
      const current = structuredClone(authFile)
      const next = await update(current)
      return (next ?? current) as MockAuthFile
    }
  )
  const setAccountCooldown = vi.fn(async () => {})

  const getOpenAIOAuthDomain = vi.fn((auth: MockAuthFile, mode: "native" | "codex") => {
    const openai = auth.openai
    if (!openai || openai.type !== "oauth") return undefined
    const scoped = openai.accounts.filter((account) => {
      const authTypes = Array.isArray(account.authTypes) ? account.authTypes : ["native"]
      return authTypes.includes(mode)
    })
    if (scoped.length === 0) return undefined
    return {
      strategy: openai.strategy,
      accounts: scoped,
      activeIdentityKey: openai.activeIdentityKey
    }
  })

  const ensureOpenAIOAuthDomain = vi.fn((auth: MockAuthFile, mode: "native" | "codex") => {
    const existing = getOpenAIOAuthDomain(auth, mode)
    if (existing) return existing
    return { accounts: [] }
  })

  const listOpenAIOAuthDomains = vi.fn((auth: MockAuthFile) =>
    (["native", "codex"] as const)
      .map((mode) => ({ mode, domain: getOpenAIOAuthDomain(auth, mode) }))
      .filter((entry): entry is { mode: "native" | "codex"; domain: { accounts: unknown[] } } =>
        Boolean(entry.domain && Array.isArray(entry.domain.accounts))
      )
  )

  vi.doMock("../lib/storage", () => ({
    loadAuthStorage,
    saveAuthStorage,
    getOpenAIOAuthDomain,
    ensureOpenAIOAuthDomain,
    listOpenAIOAuthDomains,
    setAccountCooldown,
    shouldOfferLegacyTransfer: vi.fn(async () => false)
  }))

  vi.doMock("../lib/model-catalog", () => ({
    getCodexModelCatalog: vi.fn(async () => undefined),
    applyCodexCatalogToProviderModels: vi.fn(
      (input: { providerModels: Record<string, Record<string, unknown>> }) => input.providerModels
    )
  }))

  const { CodexAuthPlugin } = await import("../lib/codex-native")
  const hooks = await CodexAuthPlugin({
    client: {
      tui: {
        showToast: vi.fn(async () => ({}))
      }
    }
  } as never)
  const loader = hooks.auth?.loader
  if (!loader) throw new Error("Missing auth loader")

  const loaded = await loader(async () => getAuthResult as never, {
    models: { "gpt-5.2-codex": { id: "gpt-5.2-codex" } }
  } as never)

  return { loaded, loadAuthStorage, saveAuthStorage, setAccountCooldown }
}

describe("codex-native fatal responses", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("returns synthetic no-accounts error in conversation response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 }))
    )

    const { loaded } = await loadPluginForAuth({
      openai: {
        type: "oauth",
        accounts: []
      }
    })

    const response = await loaded.fetch?.("https://api.openai.com/v1/responses", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.2-codex", input: "hi" })
    })

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error.type).toBe("no_accounts_configured")
    expect(body.error.message).toContain("opencode auth login")
  })

  it("enables oauth fetch path from plugin storage even when provider auth is api-key mode", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal("fetch", fetchImpl)

    const { loaded } = await loadPluginForAuth(
      {
        openai: {
          type: "oauth",
          activeIdentityKey: "acc|user@example.com|plus",
          accounts: [
            {
              identityKey: "acc|user@example.com|plus",
              accountId: "acc",
              email: "user@example.com",
              plan: "plus",
              enabled: true,
              access: "access_token",
              refresh: "refresh_token",
              expires: Date.now() + 60_000
            }
          ]
        }
      },
      { type: "api", key: "sk-test" }
    )

    expect(typeof loaded.apiKey).toBe("string")
    expect(loaded.apiKey).toContain("oauth")
    const response = await loaded.fetch?.("https://api.openai.com/v1/responses", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.2-codex", input: "hi", prompt_cache_key: "ses_test" })
    })
    expect(response?.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalled()
  })

  it("blocks outbound requests to non-openai hosts before network dispatch", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal("fetch", fetchImpl)

    const { loaded } = await loadPluginForAuth({
      openai: {
        type: "oauth",
        activeIdentityKey: "acc|user@example.com|plus",
        accounts: [
          {
            identityKey: "acc|user@example.com|plus",
            accountId: "acc",
            email: "user@example.com",
            plan: "plus",
            enabled: true,
            access: "access_token",
            refresh: "refresh_token",
            expires: Date.now() + 60_000
          }
        ]
      }
    })

    const response = await loaded.fetch?.("https://example.com/v1/models", {
      method: "GET"
    })

    expect(response?.status).toBe(400)
    const body = await response?.json()
    expect(body.error.type).toBe("disallowed_outbound_host")
    expect(body.error.message).toContain("example.com")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("returns synthetic cooldown hard-stop with wait guidance", async () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-08T12:00:00.000Z")
    vi.setSystemTime(now)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 }))
    )

    const { loaded } = await loadPluginForAuth({
      openai: {
        type: "oauth",
        activeIdentityKey: "acc|user@example.com|plus",
        accounts: [
          {
            identityKey: "acc|user@example.com|plus",
            accountId: "acc",
            email: "user@example.com",
            plan: "plus",
            enabled: true,
            cooldownUntil: now.getTime() + 90_000
          }
        ]
      }
    })

    const response = await loaded.fetch?.("https://api.openai.com/v1/responses", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.2-codex", input: "hi" })
    })

    expect(response?.status).toBe(429)
    const body = await response?.json()
    expect(body.error.type).toBe("all_accounts_cooling_down")
    expect(body.error.message).toContain("Try again in")
  })

  it("returns synthetic invalid-grant guidance for refresh failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const requestUrl = url.toString()
        if (requestUrl.includes("/oauth/token")) {
          return new Response(
            JSON.stringify({
              error: "invalid_grant",
              error_description: "refresh token revoked"
            }),
            {
              status: 400,
              headers: { "content-type": "application/json; charset=utf-8" }
            }
          )
        }
        return new Response("ok", { status: 200 })
      })
    )

    const { loaded } = await loadPluginForAuth({
      openai: {
        type: "oauth",
        activeIdentityKey: "acc|user@example.com|plus",
        accounts: [
          {
            identityKey: "acc|user@example.com|plus",
            accountId: "acc",
            email: "user@example.com",
            plan: "plus",
            enabled: true,
            refresh: "rt",
            expires: 0
          }
        ]
      }
    })

    const response = await loaded.fetch?.("https://api.openai.com/v1/responses", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.2-codex", input: "hi" })
    })

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error.type).toBe("refresh_invalid_grant")
    expect(body.error.message).toContain("reauthenticate")
  })

  it("fails over to another enabled account when one refresh token is invalid_grant", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = url.toString()
      if (requestUrl.includes("/oauth/token")) {
        return new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "refresh token revoked"
          }),
          {
            status: 400,
            headers: { "content-type": "application/json; charset=utf-8" }
          }
        )
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchImpl)

    const { loaded } = await loadPluginForAuth({
      openai: {
        type: "oauth",
        strategy: "sticky",
        activeIdentityKey: "acc-1|user1@example.com|plus",
        accounts: [
          {
            identityKey: "acc-1|user1@example.com|plus",
            accountId: "acc-1",
            email: "user1@example.com",
            plan: "plus",
            enabled: true,
            refresh: "rt-invalid",
            expires: 0
          },
          {
            identityKey: "acc-2|user2@example.com|plus",
            accountId: "acc-2",
            email: "user2@example.com",
            plan: "plus",
            enabled: true,
            access: "access-good",
            refresh: "rt-good",
            expires: Date.now() + 60_000
          }
        ]
      }
    })

    const response = await loaded.fetch?.("https://api.openai.com/v1/responses", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.2-codex", input: "hi" })
    })

    expect(response?.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const codexCall = fetchImpl.mock.calls.find((call) => !call[0].toString().includes("/oauth/token"))
    expect(codexCall).toBeDefined()
    const outboundRequest = codexCall?.[0] as Request
    expect(outboundRequest.headers.get("authorization")).toBe("Bearer access-good")
  })
})
