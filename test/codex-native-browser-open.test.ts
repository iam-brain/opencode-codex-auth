import { describe, expect, it } from "vitest"

import { browserOpenInvocationFor } from "../lib/codex-native"
import { tryOpenUrlInBrowser } from "../lib/codex-native/browser.js"

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

  it("builds Linux xdg-open invocation", () => {
    expect(browserOpenInvocationFor("https://example.com", "linux")).toEqual({
      command: "xdg-open",
      args: ["https://example.com"]
    })
  })

  it("blocks disallowed browser URL origins", async () => {
    const opened = await tryOpenUrlInBrowser({
      url: "https://evil.example.invalid/oauth",
      allowedOrigins: ["https://auth.openai.com"]
    })

    expect(opened).toBe(false)
  })
})
