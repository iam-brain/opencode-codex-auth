import { describe, expect, it } from "vitest"
import { __testOnly } from "../lib/codex-native"

describe("codex-native oauth callback page branding", () => {
  it("uses Codex branding for success page", () => {
    const html = __testOnly.buildOAuthSuccessHtml()
    expect(html).toContain("Sign into Codex")
    expect(html).toContain("Signed in to Codex")
    expect(html).not.toContain("OpenCode")
  })

  it("uses Codex branding for error page", () => {
    const html = __testOnly.buildOAuthErrorHtml("bad things")
    expect(html).toContain("Sign into Codex")
    expect(html).toContain("Sign-in failed")
    expect(html).not.toContain("OpenCode")
  })
})
