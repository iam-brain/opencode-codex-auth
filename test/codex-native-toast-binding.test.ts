import { afterEach, describe, expect, it, vi } from "vitest"

type MockAuthFile = {
  openai: {
    type: "oauth"
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

async function loadFetchForToast(input: { authFile: MockAuthFile; tui: Record<string, unknown> }) {
  vi.resetModules()

  const loadAuthStorage = vi.fn(async () => structuredClone(input.authFile))
  const saveAuthStorage = vi.fn(
    async (
      _path: string | undefined,
      update: (auth: MockAuthFile) => Promise<MockAuthFile | void> | MockAuthFile | void
    ) => {
      const current = structuredClone(input.authFile)
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
      (args: { providerModels: Record<string, Record<string, unknown>> }) => args.providerModels
    )
  }))

  const { CodexAuthPlugin } = await import("../lib/codex-native")
  const hooks = await CodexAuthPlugin({ client: { tui: input.tui } } as never)
  const loader = hooks.auth?.loader
  if (!loader) throw new Error("Missing auth loader")

  const loaded = await loader(async () => ({ type: "oauth", refresh: "", access: "", expires: 0 }) as never, {
    models: { "gpt-5.2-codex": { id: "gpt-5.2-codex" } }
  } as never)

  return loaded
}

describe("codex-native toast binding", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("calls tui.showToast with bound context (no this._client errors)", async () => {
    const calls: Array<{ body?: { message?: string; variant?: string } }> = []
    const tui = {
      _client: { connected: true },
      async showToast(this: { _client?: unknown }, payload: { body?: { message?: string; variant?: string } }) {
        if (!this._client) throw new Error("missing_client_context")
        calls.push(payload)
        return {}
      }
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    )

    const loaded = await loadFetchForToast({
      tui,
      authFile: {
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
      }
    })

    const response = await loaded.fetch?.("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "ses_123"
      },
      body: JSON.stringify({
        model: "gpt-5.2-codex",
        input: "hi",
        prompt_cache_key: "ses_123"
      })
    })

    expect(response?.status).toBe(200)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0]?.body?.message).toMatch(/^(New|Resuming) chat:/)
    expect(calls[0]?.body?.variant).toBe("info")
  })
})
