import { afterEach, describe, expect, it } from "vitest"

import { browserOpenInvocationFor } from "../lib/codex-native"
import { isAllowedBrowserUrl, normalizeAllowedOrigins, tryOpenUrlInBrowser } from "../lib/codex-native/browser.js"

const ORIGINAL_ENV = {
  OPENCODE_NO_BROWSER: process.env.OPENCODE_NO_BROWSER,
  NODE_ENV: process.env.NODE_ENV,
  VITEST: process.env.VITEST
}

describe("codex native browser launch", () => {
  afterEach(() => {
    if (ORIGINAL_ENV.OPENCODE_NO_BROWSER === undefined) delete process.env.OPENCODE_NO_BROWSER
    else process.env.OPENCODE_NO_BROWSER = ORIGINAL_ENV.OPENCODE_NO_BROWSER

    if (ORIGINAL_ENV.NODE_ENV === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV

    if (ORIGINAL_ENV.VITEST === undefined) delete process.env.VITEST
    else process.env.VITEST = ORIGINAL_ENV.VITEST
  })

  it("builds macOS open invocation", () => {
    expect(browserOpenInvocationFor("https://example.com", "darwin")).toEqual({
      command: "open",
      args: ["https://example.com"]
    })
  })

  it("builds Windows start invocation", () => {
    expect(browserOpenInvocationFor("https://example.com", "win32")).toEqual({
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", "https://example.com"]
    })
  })

  it("preserves oauth query ampersands on Windows", () => {
    const oauthUrl =
      "https://auth.openai.com/oauth/authorize?client_id=test-client&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fcallback&state=test-state"

    expect(browserOpenInvocationFor(oauthUrl, "win32")).toEqual({
      command: "rundll32.exe",
      args: ["url.dll,FileProtocolHandler", oauthUrl]
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

  it("returns false when browser auto-open is disabled by env", async () => {
    process.env.OPENCODE_NO_BROWSER = "1"

    await expect(
      tryOpenUrlInBrowser({
        url: "https://auth.openai.com/oauth/authorize",
        allowedOrigins: ["https://auth.openai.com"]
      })
    ).resolves.toBe(false)
  })

  it("returns false in test environments before attempting browser launch", async () => {
    delete process.env.OPENCODE_NO_BROWSER
    delete process.env.VITEST
    process.env.NODE_ENV = "test"

    await expect(
      tryOpenUrlInBrowser({
        url: "https://auth.openai.com/oauth/authorize",
        allowedOrigins: ["https://auth.openai.com"]
      })
    ).resolves.toBe(false)
  })

  it("reports disallowed URLs through events and logger", async () => {
    delete process.env.OPENCODE_NO_BROWSER
    delete process.env.NODE_ENV
    delete process.env.VITEST

    const events: Array<{ event: string; meta?: Record<string, unknown> }> = []
    const warnings: Array<{ msg: string; meta?: Record<string, unknown> }> = []

    const allowed = await tryOpenUrlInBrowser({
      url: "https://evil.example.invalid/oauth",
      allowedOrigins: ["https://auth.openai.com"],
      log: {
        debug: () => {},
        info: () => {},
        warn: (msg, meta) => warnings.push({ msg, meta }),
        error: () => {}
      },
      onEvent: (event, meta) => events.push({ event, meta })
    })

    expect(allowed).toBe(false)
    expect(events).toEqual([
      {
        event: "browser_open_blocked",
        meta: { reason: "invalid_or_disallowed_url" }
      }
    ])
    expect(warnings).toEqual([
      {
        msg: "blocked auto-open oauth URL",
        meta: { reason: "invalid_or_disallowed_url" }
      }
    ])
  })
})
