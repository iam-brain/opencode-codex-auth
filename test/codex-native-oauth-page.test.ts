import { describe, expect, it } from "vitest"
import { __testOnly } from "../lib/codex-native"

function mockJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.${encode("sig")}`
}

describe("codex-native oauth callback page branding", () => {
  it("uses Codex branding for success page", () => {
    const html = __testOnly.buildOAuthSuccessHtml()
    expect(html).toContain("Sign into Codex")
    expect(html).toContain("Signed in to Codex")
    expect(html).toContain("Finish setting up your API organization")
    expect(html).not.toContain("OpenCode")
  })

  it("uses OpenCode-native branding for native success page", () => {
    const html = __testOnly.buildOAuthSuccessHtml("native")
    expect(html).toContain("OpenCode - Codex Authorization Successful")
    expect(html).toContain("Authorization Successful")
    expect(html).toContain("You can close this window and return to OpenCode.")
    expect(html).not.toContain("Signed in to Codex")
  })

  it("uses Codex branding for error page", () => {
    const html = __testOnly.buildOAuthErrorHtml("bad things")
    expect(html).toContain("Sign into Codex")
    expect(html).toContain("Sign-in failed")
    expect(html).not.toContain("OpenCode")
  })

  it("builds codex success redirect with setup query params from token claims", () => {
    const idToken = mockJwt({
      "https://api.openai.com/auth": {
        organization_id: "org_123",
        project_id: "proj_456",
        completed_platform_onboarding: false,
        is_org_owner: true
      }
    })
    const accessToken = mockJwt({
      "https://api.openai.com/auth": {
        chatgpt_plan_type: "plus"
      }
    })

    const redirectUrl = __testOnly.composeCodexSuccessRedirectUrl({
      id_token: idToken,
      access_token: accessToken,
      refresh_token: "refresh"
    })

    const parsed = new URL(redirectUrl)
    expect(parsed.pathname).toBe("/success")
    expect(parsed.searchParams.get("needs_setup")).toBe("true")
    expect(parsed.searchParams.get("org_id")).toBe("org_123")
    expect(parsed.searchParams.get("project_id")).toBe("proj_456")
    expect(parsed.searchParams.get("plan_type")).toBe("plus")
    expect(parsed.searchParams.get("platform_url")).toBe("https://platform.openai.com")
    expect(parsed.searchParams.get("id_token")).toBe(idToken)
  })

  it("maps auth account domain from runtime mode", () => {
    expect(__testOnly.modeForRuntimeMode("native")).toBe("native")
    expect(__testOnly.modeForRuntimeMode("codex")).toBe("codex")
    expect(__testOnly.modeForRuntimeMode("collab")).toBe("codex")
  })
})
