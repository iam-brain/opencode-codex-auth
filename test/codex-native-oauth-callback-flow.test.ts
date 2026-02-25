import http from "node:http"

import { afterEach, describe, expect, it, vi } from "vitest"

type StorageState = {
  openai: Record<string, unknown>
}

type BrowserAuthorizeFlow = {
  url: string
  displayUrl?: string
  callback: (...args: string[]) => Promise<{ type: string }>
}

function buildJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.${encode("sig")}`
}

async function httpGet(url: string): Promise<{
  statusCode: number
  location?: string
  body: string
  headers: Record<string, string | undefined>
}> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const location = Array.isArray(res.headers.location) ? res.headers.location[0] : res.headers.location
      const contentSecurityPolicy = Array.isArray(res.headers["content-security-policy"])
        ? res.headers["content-security-policy"][0]
        : res.headers["content-security-policy"]
      const cacheControl = Array.isArray(res.headers["cache-control"])
        ? res.headers["cache-control"][0]
        : res.headers["cache-control"]
      const referrerPolicy = Array.isArray(res.headers["referrer-policy"])
        ? res.headers["referrer-policy"][0]
        : res.headers["referrer-policy"]
      const chunks: Buffer[] = []
      res.on("data", (chunk) => {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
      })
      res.once("end", () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          location,
          body: Buffer.concat(chunks).toString("utf8"),
          headers: {
            "content-security-policy": contentSecurityPolicy,
            "cache-control": cacheControl,
            "referrer-policy": referrerPolicy
          }
        })
      })
    })
    req.once("error", reject)
    req.setTimeout(5000, () => {
      req.destroy(new Error("request timeout"))
    })
  })
}

async function loadPluginForOAuthFlow(input: { mode: "native" | "codex"; spoofMode: "native" | "codex" }) {
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
  afterEach(async () => {
    const { __testOnly } = await import("../lib/codex-native")
    __testOnly.stopOAuthServer()
    vi.unstubAllGlobals()
  })

  it("persists codex account domain from runtime mode even with debug + native spoof", async () => {
    const previousDebug = process.env.CODEX_AUTH_DEBUG
    const previousGrace = process.env.CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS
    process.env.CODEX_AUTH_DEBUG = "1"
    process.env.CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS = "5000"

    try {
      const { hooks, storageState } = await loadPluginForOAuthFlow({
        mode: "codex",
        spoofMode: "native"
      })
      const browserMethod = hooks.auth?.methods.find((method) => method.label === "ChatGPT Pro/Plus (browser)")
      if (!browserMethod || browserMethod.type !== "oauth") throw new Error("Missing browser oauth method")

      const flow = (await browserMethod.authorize()) as BrowserAuthorizeFlow
      const authUrl = new URL(flow.url)
      const state = authUrl.searchParams.get("state")
      expect(state).toBeTruthy()
      if (!state) throw new Error("missing oauth state")
      const displayUrl = flow.displayUrl
      expect(displayUrl).toBeTruthy()
      expect(displayUrl).toContain("state=%5Bredacted%5D")
      expect(displayUrl).not.toContain(`state=${state}`)
      expect(flow.url).not.toContain("state=%5Bredacted%5D")

      const callbackResponse = await httpGet(
        `http://localhost:1455/auth/callback?code=test_code&state=${encodeURIComponent(state)}`
      )
      expect(callbackResponse.statusCode).toBe(302)
      expect(callbackResponse.location).toContain("/success?")
      expect(callbackResponse.location).not.toContain("id_token=")
      expect(callbackResponse.headers["cache-control"]).toBe("no-store")
      expect(callbackResponse.headers["referrer-policy"]).toBe("no-referrer")

      const result = await flow.callback("")
      expect(result.type).toBe("success")
      if (!callbackResponse.location) throw new Error("missing success redirect")
      const successResponse = await httpGet(callbackResponse.location)
      expect(successResponse.statusCode).toBe(200)
      expect(successResponse.body).toContain("Signed in to Codex")
      expect(successResponse.headers["cache-control"]).toBe("no-store")
      expect(successResponse.headers["referrer-policy"]).toBe("no-referrer")
      expect(successResponse.headers["content-security-policy"]).toContain("default-src 'none'")

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
      if (previousGrace === undefined) {
        delete process.env.CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS
      } else {
        process.env.CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS = previousGrace
      }
    }
  })

  it("serves native success HTML when runtime mode is native", async () => {
    const previousDebug = process.env.CODEX_AUTH_DEBUG
    const previousGrace = process.env.CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS
    process.env.CODEX_AUTH_DEBUG = "1"
    process.env.CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS = "5000"

    try {
      const { hooks } = await loadPluginForOAuthFlow({
        mode: "native",
        spoofMode: "codex"
      })
      const browserMethod = hooks.auth?.methods.find((method) => method.label === "ChatGPT Pro/Plus (browser)")
      if (!browserMethod || browserMethod.type !== "oauth") throw new Error("Missing browser oauth method")

      const flow = (await browserMethod.authorize()) as BrowserAuthorizeFlow
      const authUrl = new URL(flow.url)
      const state = authUrl.searchParams.get("state")
      expect(state).toBeTruthy()
      if (!state) throw new Error("missing oauth state")

      const callbackResponse = await httpGet(
        `http://localhost:1455/auth/callback?code=test_code&state=${encodeURIComponent(state)}`
      )
      expect(callbackResponse.statusCode).toBe(200)
      expect(callbackResponse.location).toBeUndefined()
      expect(callbackResponse.body).toContain("Authorization Successful")
      expect(callbackResponse.body).toContain("return to OpenCode")
      expect(callbackResponse.body).not.toContain("Signed in to Codex")
      expect(callbackResponse.headers["cache-control"]).toBe("no-store")
      expect(callbackResponse.headers["referrer-policy"]).toBe("no-referrer")
      expect(callbackResponse.headers["content-security-policy"]).toContain("default-src 'none'")

      const result = await flow.callback("")
      expect(result.type).toBe("success")
    } finally {
      if (previousDebug === undefined) {
        delete process.env.CODEX_AUTH_DEBUG
      } else {
        process.env.CODEX_AUTH_DEBUG = previousDebug
      }
      if (previousGrace === undefined) {
        delete process.env.CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS
      } else {
        process.env.CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS = previousGrace
      }
    }
  })

  it("keeps oauth callback server alive briefly after auth error", async () => {
    const previousDebug = process.env.CODEX_AUTH_DEBUG
    const previousGrace = process.env.CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS
    const previousErrorGrace = process.env.CODEX_OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS
    process.env.CODEX_AUTH_DEBUG = "1"
    process.env.CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS = "100"
    process.env.CODEX_OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS = "5000"

    try {
      const { hooks } = await loadPluginForOAuthFlow({
        mode: "codex",
        spoofMode: "codex"
      })
      const browserMethod = hooks.auth?.methods.find((method) => method.label === "ChatGPT Pro/Plus (browser)")
      if (!browserMethod || browserMethod.type !== "oauth") throw new Error("Missing browser oauth method")

      const flow = (await browserMethod.authorize()) as BrowserAuthorizeFlow
      const authUrl = new URL(flow.url)
      const state = authUrl.searchParams.get("state")
      expect(state).toBeTruthy()
      if (!state) throw new Error("missing oauth state")

      const callbackResultPromise = flow.callback("")
      const callbackUrl = `http://localhost:1455/auth/callback?error=request_forbidden&error_description=csrf&state=${encodeURIComponent(state)}`
      const callbackResponse = await httpGet(callbackUrl)
      expect(callbackResponse.statusCode).toBe(200)
      expect(callbackResponse.body).toContain("Sign-in failed")

      const result = await callbackResultPromise
      expect(result.type).toBe("failed")

      const retryResponse = await httpGet(callbackUrl)
      expect(retryResponse.statusCode).toBe(200)
      expect(retryResponse.body).toContain("Sign-in failed")
    } finally {
      if (previousDebug === undefined) {
        delete process.env.CODEX_AUTH_DEBUG
      } else {
        process.env.CODEX_AUTH_DEBUG = previousDebug
      }
      if (previousGrace === undefined) {
        delete process.env.CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS
      } else {
        process.env.CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS = previousGrace
      }
      if (previousErrorGrace === undefined) {
        delete process.env.CODEX_OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS
      } else {
        process.env.CODEX_OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS = previousErrorGrace
      }
    }
  })

  it("rejects callback error requests without matching oauth state", async () => {
    const { hooks } = await loadPluginForOAuthFlow({
      mode: "codex",
      spoofMode: "codex"
    })
    const browserMethod = hooks.auth?.methods.find((method) => method.label === "ChatGPT Pro/Plus (browser)")
    if (!browserMethod || browserMethod.type !== "oauth") throw new Error("Missing browser oauth method")

    const flow = (await browserMethod.authorize()) as BrowserAuthorizeFlow
    const authUrl = new URL(flow.url)
    const state = authUrl.searchParams.get("state")
    expect(state).toBeTruthy()
    if (!state) throw new Error("missing oauth state")

    const wrongStateError = await httpGet(
      "http://localhost:1455/auth/callback?error=request_forbidden&error_description=csrf&state=wrong"
    )
    expect(wrongStateError.statusCode).toBe(400)
    expect(wrongStateError.body).toContain("Invalid state")

    const callbackResultPromise = flow.callback("")
    const correctStateError = await httpGet(
      `http://localhost:1455/auth/callback?error=request_forbidden&error_description=csrf&state=${encodeURIComponent(state)}`
    )
    expect(correctStateError.statusCode).toBe(200)
    expect(correctStateError.body).toContain("Sign-in failed")

    const result = await callbackResultPromise
    expect(result.type).toBe("failed")
  })

  it("rejects cancel requests without matching oauth state", async () => {
    const { hooks } = await loadPluginForOAuthFlow({
      mode: "codex",
      spoofMode: "codex"
    })
    const browserMethod = hooks.auth?.methods.find((method) => method.label === "ChatGPT Pro/Plus (browser)")
    if (!browserMethod || browserMethod.type !== "oauth") throw new Error("Missing browser oauth method")

    const flow = (await browserMethod.authorize()) as BrowserAuthorizeFlow
    const authUrl = new URL(flow.url)
    const state = authUrl.searchParams.get("state")
    expect(state).toBeTruthy()
    if (!state) throw new Error("missing oauth state")

    const missingState = await httpGet("http://localhost:1455/cancel")
    expect(missingState.statusCode).toBe(400)
    expect(missingState.body).toContain("Invalid cancel state")

    const wrongState = await httpGet("http://localhost:1455/cancel?state=wrong")
    expect(wrongState.statusCode).toBe(400)
    expect(wrongState.body).toContain("Invalid cancel state")

    const callbackResponse = await httpGet(
      `http://localhost:1455/auth/callback?code=test_code&state=${encodeURIComponent(state)}`
    )
    expect(callbackResponse.statusCode).toBe(302)

    const result = await flow.callback("")
    expect(result.type).toBe("success")
  })

  it("cancels oauth flow only with matching cancel state", async () => {
    const { hooks } = await loadPluginForOAuthFlow({
      mode: "codex",
      spoofMode: "codex"
    })
    const browserMethod = hooks.auth?.methods.find((method) => method.label === "ChatGPT Pro/Plus (browser)")
    if (!browserMethod || browserMethod.type !== "oauth") throw new Error("Missing browser oauth method")

    const flow = (await browserMethod.authorize()) as BrowserAuthorizeFlow
    const authUrl = new URL(flow.url)
    const state = authUrl.searchParams.get("state")
    expect(state).toBeTruthy()
    if (!state) throw new Error("missing oauth state")

    const callbackResultPromise = flow.callback("")
    const cancelResponse = await httpGet(`http://localhost:1455/cancel?state=${encodeURIComponent(state)}`)
    expect(cancelResponse.statusCode).toBe(200)
    expect(cancelResponse.body).toContain("Login cancelled")

    const result = await callbackResultPromise
    expect(result.type).toBe("failed")
  })
})
