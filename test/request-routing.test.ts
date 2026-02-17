import { describe, expect, it } from "vitest"

import { PluginFatalError } from "../lib/fatal-errors"
import { assertAllowedOutboundUrl, rewriteUrl } from "../lib/codex-native/request-routing"

describe("request routing", () => {
  it("blocks non-https outbound protocols", () => {
    expect(() => assertAllowedOutboundUrl(new URL("http://api.openai.com/v1/responses"))).toThrow(PluginFatalError)
  })

  it("allows openai subdomains", () => {
    expect(() => assertAllowedOutboundUrl(new URL("https://foo.openai.com/v1/models"))).not.toThrow()
  })

  it("allows chatgpt subdomains", () => {
    expect(() => assertAllowedOutboundUrl(new URL("https://foo.chatgpt.com/backend-api/codex/responses"))).not.toThrow()
  })

  it("rewrites chat/completions path to codex endpoint", () => {
    const rewritten = rewriteUrl("https://api.openai.com/v1/chat/completions")
    expect(rewritten.toString()).toBe("https://chatgpt.com/backend-api/codex/responses")
  })
})
