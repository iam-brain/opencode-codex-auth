import http from "node:http"

import { afterEach, describe, expect, it, vi } from "vitest"

type StorageState = {
  openai: Record<string, unknown>
}

function buildJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.${encode("sig")}`
}

async function httpGet(url: string): Promise<{ statusCode: number; location?: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const location = Array.isArray(res.headers.location)
        ? res.headers.location[0]
        : res.headers.location
      res.resume()
      res.once("end", () => {
        resolve({ statusCode: res.statusCode ?? 0, location })
      })
    })
    req.once("error", reject)
    req.setTimeout(5000, () => {
      req.destroy(new Error("request timeout"))
    })
  })
}

async function loadPluginForOAuthFlow(input: {
  mode: "native" | "codex" | "collab"
  spoofMode: "native" | "codex"
}) {
  vi.resetModules()

  const storageState: StorageState = {
    openai: {
      type: "oauth",
      accounts: []
    }
  }

  const saveAuthStorage = vi.fn(
    async (
      _filePath: string | undefined,
      update: (auth: StorageState) => Promise<StorageState | void> | StorageState | void
    ) => {
      const next = await update(storageState)
      return next ?? storageState
    }
  )

  const getOpenAIOAuthDomain = vi.fn((auth: StorageState, mode: "native" | "codex") => {
    const openai = auth.openai as Record<string, unknown>
    const existing = openai[mode] as { accounts?: unknown[] } | undefined
    if (existing && Array.isArray(existing.accounts)) return existing
    return undefined
  })

  const ensureOpenAIOAuthDomain = vi.fn((auth: StorageState, mode: "native" | "codex") => {
    const existing = getOpenAIOAuthDomain(auth, mode)
    if (existing) return existing
    const openai = auth.openai as Record<string, unknown>
    const created = { accounts: [] as unknown[] }
    openai[mode] = created
    return created
  })

  vi.doMock("../lib/storage", () => ({
    loadAuthStorage: vi.fn(async () => storageState),
    saveAuthStorage,
    importLegacyInstallData: vi.fn(async () => ({ imported: 0, sourcesUsed: 0 })),
    getOpenAIOAuthDomain,
    ensureOpenAIOAuthDomain,
    listOpenAIOAuthDomains: vi.fn(() => []),
    setAccountCooldown: vi.fn(async () => {}),
    shouldOfferLegacyTransfer: vi.fn(async () => false)
  }))

  vi.doMock("../lib/model-catalog", () => ({
    getCodexModelCatalog: vi.fn(async () => undefined),
    applyCodexCatalogToProviderModels: vi.fn(
      (args: { providerModels: Record<string, unknown> }) => args.providerModels
    ),
    resolveInstructionsForModel: vi.fn(() => undefined)
  }))

  const idToken = buildJwt({
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acc_codex",
      chatgpt_plan_type: "plus",
      organization_id: "org_123",
      project_id: "proj_456",
      completed_platform_onboarding: true,
      is_org_owner: true
    },
    "https://api.openai.com/profile": {
      email: "codex@example.com"
    }
  })
  const accessToken = buildJwt({
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acc_codex",
      chatgpt_plan_type: "plus"
    },
    "https://api.openai.com/profile": {
      email: "codex@example.com"
    }
  })

  vi.stubGlobal(
    "fetch",
    vi.fn(async (inputUrl: RequestInfo | URL) => {
      const url = typeof inputUrl === "string" ? inputUrl : inputUrl.toString()
      if (url.endsWith("/oauth/token")) {
        return new Response(
          JSON.stringify({
            id_token: idToken,
            access_token: accessToken,
            refresh_token: "rt_codex",
            expires_in: 3600
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      }
      throw new Error(`unexpected fetch URL in test: ${url}`)
    })
  )

  const { CodexAuthPlugin } = await import("../lib/codex-native")
  const hooks = await CodexAuthPlugin({} as never, {
    mode: input.mode,
    spoofMode: input.spoofMode
  })
  return { hooks, storageState, saveAuthStorage }
}

describe("codex-native oauth callback flow", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("persists codex account domain from runtime mode even with debug + native spoof", async () => {
    const previousDebug = process.env.CODEX_AUTH_DEBUG
    process.env.CODEX_AUTH_DEBUG = "1"

    try {
      const { hooks, storageState } = await loadPluginForOAuthFlow({
        mode: "codex",
        spoofMode: "native"
      })
      const browserMethod = hooks.auth?.methods.find((method) => method.label === "ChatGPT Pro/Plus (browser)")
      if (!browserMethod || browserMethod.type !== "oauth") throw new Error("Missing browser oauth method")

      const flow = await browserMethod.authorize()
      const authUrl = new URL(flow.url)
      const state = authUrl.searchParams.get("state")
      expect(state).toBeTruthy()
      if (!state) throw new Error("missing oauth state")

      const callbackResponse = await httpGet(
        `http://localhost:1455/auth/callback?code=test_code&state=${encodeURIComponent(state)}`
      )
      expect(callbackResponse.statusCode).toBe(302)
      expect(callbackResponse.location).toContain("/success?")

      const result = await flow.callback()
      expect(result.type).toBe("success")

      const openai = storageState.openai as {
        native?: { accounts?: unknown[] }
        codex?: { accounts?: Array<{ identityKey?: string }> }
      }
      expect(openai.codex?.accounts?.length).toBe(1)
      expect(openai.native?.accounts?.length ?? 0).toBe(0)
      expect(openai.codex?.accounts?.[0]?.identityKey).toBe("acc_codex|codex@example.com|plus")
    } finally {
      if (previousDebug === undefined) {
        delete process.env.CODEX_AUTH_DEBUG
      } else {
        process.env.CODEX_AUTH_DEBUG = previousDebug
      }
    }
  })
})
