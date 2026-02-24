import { describe, expect, it } from "vitest"

import { browserOpenInvocationFor } from "../lib/codex-native"
import { isAllowedBrowserUrl, normalizeAllowedOrigins } from "../lib/codex-native/browser.js"

describe("codex native browser launch", () => {
  it("builds macOS open invocation", () => {
    expect(browserOpenInvocationFor("https://example.com", "darwin")).toEqual({
      command: "open",
      args: ["https://example.com"]
    })
  })

  it("builds Windows start invocation", () => {
    expect(browserOpenInvocationFor("https://example.com", "win32")).toEqual({
      command: "explorer.exe",
      args: ["https://example.com"]
    })
  })

  it("preserves oauth query ampersands on Windows", () => {
    const oauthUrl =
      "https://auth.openai.com/oauth/authorize?client_id=test-client&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fcallback&state=test-state"

    expect(browserOpenInvocationFor(oauthUrl, "win32")).toEqual({
      command: "explorer.exe",
      args: [oauthUrl]
    })
  })

  it("builds Linux xdg-open invocation", () => {
    expect(browserOpenInvocationFor("https://example.com", "linux")).toEqual({
      command: "xdg-open",
      args: ["https://example.com"]
    })
  })

  it("allows allowlisted https browser URLs", () => {
    const allowedOrigins = normalizeAllowedOrigins(["https://auth.openai.com"])
    expect(isAllowedBrowserUrl("https://auth.openai.com/oauth/authorize?client_id=abc", allowedOrigins)).toBe(true)
  })

  it("blocks disallowed browser URL origins", () => {
    const allowedOrigins = normalizeAllowedOrigins(["https://auth.openai.com"])
    expect(isAllowedBrowserUrl("https://evil.example.invalid/oauth", allowedOrigins)).toBe(false)
  })

  it("blocks browser URLs with credentials", () => {
    const allowedOrigins = normalizeAllowedOrigins(["https://auth.openai.com"])
    expect(isAllowedBrowserUrl("https://alice:secret@auth.openai.com/oauth/authorize", allowedOrigins)).toBe(false)
  })

  it("blocks non-http browser URL schemes", () => {
    const allowedOrigins = normalizeAllowedOrigins(["https://auth.openai.com"])
    expect(isAllowedBrowserUrl("file:///tmp/oauth.html", allowedOrigins)).toBe(false)
  })
})
