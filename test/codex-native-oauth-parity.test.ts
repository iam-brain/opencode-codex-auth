import { afterEach, describe, expect, it, vi } from "vitest"
import { __testOnly } from "../lib/codex-native"
import { createHeadlessOAuthAuthorize } from "../lib/codex-native/oauth-auth-methods"
import { OAUTH_CALLBACK_URI } from "../lib/codex-native/oauth-utils"
import { fetchWithTimeout } from "../lib/codex-native/oauth-utils"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("codex-native oauth parity", () => {
  it("builds authorize URLs with codex-rs style encoding", () => {
    const url = __testOnly.buildAuthorizeUrl(
      "http://localhost:1455/auth/callback",
      {
        verifier: "unused_for_url",
        challenge: "abc123-_~"
      },
      "state_value",
      "codex_cli_rs"
    )

    expect(url).toBe(
      "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&scope=openid%20profile%20email%20offline_access&code_challenge=abc123-_~&code_challenge_method=S256&id_token_add_organizations=true&codex_cli_simplified_flow=true&state=state_value&originator=codex_cli_rs"
    )
    expect(url).not.toContain("openid+profile+email+offline_access")
  })

  it("builds authorize URLs with OpenCode native originator for native mode", () => {
    const url = __testOnly.buildAuthorizeUrl(
      "http://localhost:1455/auth/callback",
      {
        verifier: "unused_for_url",
        challenge: "abc123-_~"
      },
      "state_value",
      "opencode"
    )

    expect(url).toContain("&originator=opencode")
    expect(url).not.toContain("&originator=codex_cli_rs")
  })

  it("generates codex-rs style PKCE lengths and charset", async () => {
    const pkce = await __testOnly.generatePKCE()

    expect(pkce.verifier).toHaveLength(86)
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(pkce.challenge).toHaveLength(43)
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it("uses localhost callback URI for native oauth parity", () => {
    expect(OAUTH_CALLBACK_URI).toBe("http://localhost:1455/auth/callback")
  })

  it("uses version-only native user-agent for headless device auth", async () => {
    const fetchMock = vi.fn(async (inputUrl: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof inputUrl === "string" ? inputUrl : inputUrl.toString()
      if (url.endsWith("/api/accounts/deviceauth/usercode")) {
        return new Response(JSON.stringify({ device_auth_id: "device_123", user_code: "ABCD", interval: "5" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      }
      throw new Error(`unexpected fetch URL in test: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const authorize = createHeadlessOAuthAuthorize({
      spoofMode: "native",
      persistOAuthTokens: async () => {}
    })

    await authorize()

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers["User-Agent"]).toMatch(/^opencode\/\d+\.\d+\.\d+$/)
  })

  it("forces oauth fetch calls to reject redirects", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    await fetchWithTimeout("https://auth.openai.com/oauth/token", { method: "POST" }, 1000)

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect(init?.redirect).toBe("error")
  })
})
