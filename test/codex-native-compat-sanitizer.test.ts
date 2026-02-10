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

type PluginOpts = {
  compatInputSanitizer?: boolean
}

async function loadPluginForAuth(authFile: MockAuthFile, pluginOpts?: PluginOpts) {
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
      .filter(
        (entry): entry is { mode: "native" | "codex"; domain: { accounts: unknown[] } } =>
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
  const hooks = await CodexAuthPlugin({} as never, pluginOpts)
  const loader = hooks.auth?.loader
  if (!loader) throw new Error("Missing auth loader")

  const loaded = await loader(
    async () => ({ type: "oauth", refresh: "", access: "", expires: 0 } as never),
    { models: { "gpt-5.2-codex": { id: "gpt-5.2-codex" } } } as never
  )

  return { loaded, loadAuthStorage, saveAuthStorage, setAccountCooldown }
}

describe("codex-native compat input sanitizer wiring", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("sanitizes malformed input items when enabled", async () => {
    let capturedBody: Record<string, unknown> | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const req = input instanceof Request ? input : new Request(input)
        capturedBody = JSON.parse(await req.clone().text()) as Record<string, unknown>
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" }
        })
      })
    )

    const { loaded } = await loadPluginForAuth(
      {
        openai: {
          type: "oauth",
          activeIdentityKey: "acc|user@example.com|plus",
          accounts: [
            {
              identityKey: "acc|user@example.com|plus",
              accountId: "acc_123",
              email: "user@example.com",
              plan: "plus",
              enabled: true,
              access: "at",
              refresh: "rt",
              expires: Date.now() + 60_000
            }
          ]
        }
      },
      { compatInputSanitizer: true }
    )

    const response = await loaded.fetch?.("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.2-codex",
        input: [{ type: "function_call_output", output: "tool result", item_reference: "bad_ref" }]
      })
    })

    expect(response?.status).toBe(200)
    expect(capturedBody?.input).toEqual([
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "tool result" }]
      }
    ])
  })

  it("preserves input items when sanitizer is disabled", async () => {
    let capturedBody: Record<string, unknown> | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const req = input instanceof Request ? input : new Request(input)
        capturedBody = JSON.parse(await req.clone().text()) as Record<string, unknown>
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" }
        })
      })
    )

    const { loaded } = await loadPluginForAuth({
      openai: {
        type: "oauth",
        activeIdentityKey: "acc|user@example.com|plus",
        accounts: [
          {
            identityKey: "acc|user@example.com|plus",
            accountId: "acc_123",
            email: "user@example.com",
            plan: "plus",
            enabled: true,
            access: "at",
            refresh: "rt",
            expires: Date.now() + 60_000
          }
        ]
      }
    })

    const requestBody = {
      model: "gpt-5.2-codex",
      input: [{ type: "function_call_output", output: "tool result", item_reference: "bad_ref" }]
    }

    const response = await loaded.fetch?.("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody)
    })

    expect(response?.status).toBe(200)
    expect(capturedBody).toEqual(requestBody)
  })
})
