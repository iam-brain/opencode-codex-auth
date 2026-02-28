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

    const parsed = new URL(url)
    expect(`${parsed.origin}${parsed.pathname}`).toBe("https://auth.openai.com/oauth/authorize")
    expect(parsed.searchParams.get("response_type")).toBe("code")
    expect(parsed.searchParams.get("client_id")).toBe("app_EMoamEEZ73f0CkXaXp7hrann")
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:1455/auth/callback")
    expect(parsed.searchParams.get("scope")).toBe("openid profile email offline_access")
    expect(parsed.searchParams.get("code_challenge")).toBe("abc123-_~")
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256")
    expect(parsed.searchParams.get("id_token_add_organizations")).toBe("true")
    expect(parsed.searchParams.get("codex_cli_simplified_flow")).toBe("true")
    expect(parsed.searchParams.get("state")).toBe("state_value")
    expect(parsed.searchParams.get("originator")).toBe("codex_cli_rs")
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
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response("ok", { status: 200 })
    )
    vi.stubGlobal("fetch", fetchMock)

    await fetchWithTimeout("https://auth.openai.com/oauth/token", { method: "POST" }, 1000)

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect(init?.redirect).toBe("error")
  })
})
