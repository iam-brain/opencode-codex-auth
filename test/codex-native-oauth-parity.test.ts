import { describe, expect, it } from "vitest"
import { __testOnly } from "../lib/codex-native"

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

  it("generates codex-rs style PKCE lengths and charset", async () => {
    const pkce = await __testOnly.generatePKCE()

    expect(pkce.verifier).toHaveLength(86)
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(pkce.challenge).toHaveLength(43)
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
