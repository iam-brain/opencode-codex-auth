import { describe, expect, it } from "vitest"

import { browserOpenInvocationFor } from "../lib/codex-native"

describe("codex native browser launch", () => {
  it("builds macOS open invocation", () => {
    expect(browserOpenInvocationFor("https://example.com", "darwin")).toEqual({
      command: "open",
      args: ["https://example.com"]
    })
  })

  it("builds Windows start invocation", () => {
    expect(browserOpenInvocationFor("https://example.com", "win32")).toEqual({
      command: "rundll32",
      args: ["url.dll,FileProtocolHandler", "https://example.com"]
    })
  })

  it("builds Linux xdg-open invocation", () => {
    expect(browserOpenInvocationFor("https://example.com", "linux")).toEqual({
      command: "xdg-open",
      args: ["https://example.com"]
    })
  })
})
