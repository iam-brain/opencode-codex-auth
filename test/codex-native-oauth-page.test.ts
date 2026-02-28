import vm from "node:vm"

import { describe, expect, it } from "vitest"
import { __testOnly } from "../lib/codex-native"

function mockJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.${encode("sig")}`
}

describe("codex-native oauth callback page branding", () => {
  function executeSuccessPageScript(search: string): {
    setupBox: { style: { display: string } }
    closeBox: { style: { display: string } }
    redirectText: { textContent: string }
    replaceCalls: string[]
    runAllTimers: (limit?: number) => void
  } {
    const html = __testOnly.buildOAuthSuccessHtml()
    const scriptMatch = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)
    if (!scriptMatch?.[1]) {
      throw new Error("OAuth success script block not found")
    }

    const setupBox = { style: { display: "none" } }
    const closeBox = { style: { display: "none" } }
    const redirectText = { textContent: "" }
    const replaceCalls: string[] = []
    const timers: Array<() => void> = []

    const document = {
      querySelector(selector: string): { style?: { display: string }; textContent?: string } | null {
        if (selector === ".setup-box") return setupBox
        if (selector === ".close-box") return closeBox
        if (selector === ".redirect-text") return redirectText
        return null
      }
    }

    const window = {
      location: {
        search,
        replace(url: string) {
          replaceCalls.push(url)
        }
      }
    }

    vm.runInNewContext(scriptMatch[1], {
      window,
      document,
      URL,
      URLSearchParams,
      setTimeout: (callback: () => void) => {
        timers.push(callback)
        return timers.length
      }
    })

    const runAllTimers = (limit = 8): void => {
      let remaining = limit
      while (timers.length > 0 && remaining > 0) {
        const next = timers.shift()
        if (next) next()
        remaining -= 1
      }
    }

    return { setupBox, closeBox, redirectText, replaceCalls, runAllTimers }
  }

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
    expect(parsed.searchParams.get("id_token")).toBeNull()
  })

  it("ignores untrusted platform_url query values in success page redirect script", () => {
    const html = __testOnly.buildOAuthSuccessHtml()
    expect(html).toContain("new Set(['https://platform.openai.com', 'https://platform.api.openai.org'])")
    expect(html).toContain("if (!allowed.has(candidate)) return 'https://platform.openai.com';")
  })

  it("executes setup redirect flow with countdown when needs_setup is true", () => {
    const result = executeSuccessPageScript(
      "?needs_setup=true&platform_url=https%3A%2F%2Fplatform.api.openai.org&org_id=org_123&project_id=proj_456&plan_type=plus"
    )

    expect(result.setupBox.style.display).toBe("flex")
    expect(result.closeBox.style.display).toBe("none")
    expect(result.redirectText.textContent).toContain("Redirecting in 3s")

    result.runAllTimers()

    expect(result.replaceCalls).toHaveLength(1)
    const redirectUrl = new URL(result.replaceCalls[0]!)
    expect(redirectUrl.origin).toBe("https://platform.api.openai.org")
    expect(redirectUrl.pathname).toBe("/org-setup")
    expect(redirectUrl.searchParams.get("p")).toBe("plus")
    expect(redirectUrl.searchParams.get("with_org")).toBe("org_123")
    expect(redirectUrl.searchParams.get("project_id")).toBe("proj_456")
  })

  it("falls back to trusted platform URL when platform_url is not allowlisted", () => {
    const result = executeSuccessPageScript("?needs_setup=true&platform_url=https%3A%2F%2Fevil.example")
    result.runAllTimers()

    expect(result.replaceCalls).toHaveLength(1)
    const redirectUrl = new URL(result.replaceCalls[0]!)
    expect(redirectUrl.origin).toBe("https://platform.openai.com")
    expect(redirectUrl.pathname).toBe("/org-setup")
  })

  it("shows close message without redirect when needs_setup is false", () => {
    const result = executeSuccessPageScript("?needs_setup=false")

    expect(result.setupBox.style.display).toBe("none")
    expect(result.closeBox.style.display).toBe("flex")
    result.runAllTimers()
    expect(result.replaceCalls).toHaveLength(0)
  })

  it("maps auth account domain from runtime mode", () => {
    expect(__testOnly.modeForRuntimeMode("native")).toBe("native")
    expect(__testOnly.modeForRuntimeMode("codex")).toBe("codex")
  })
})
