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

  it("blocks non-default https ports", () => {
    expect(() => assertAllowedOutboundUrl(new URL("https://api.openai.com:4443/v1/responses"))).toThrow(
      PluginFatalError
    )
  })

  it("rewrites chat/completions path to codex endpoint", () => {
    const rewritten = rewriteUrl("https://api.openai.com/v1/chat/completions")
    expect(rewritten.toString()).toBe("https://chatgpt.com/backend-api/codex/responses")
  })

  it("rewrites non-v1 chat/completions path to codex endpoint", () => {
    const rewritten = rewriteUrl("https://api.openai.com/chat/completions")
    expect(rewritten.toString()).toBe("https://chatgpt.com/backend-api/codex/responses")
  })

  it("rewrites exact responses path to codex endpoint", () => {
    const rewritten = rewriteUrl("https://api.openai.com/v1/responses")
    expect(rewritten.toString()).toBe("https://chatgpt.com/backend-api/codex/responses")
  })

  it("does not rewrite lookalike paths", () => {
    const rewritten = rewriteUrl("https://api.openai.com/v1/responsesx")
    expect(rewritten.toString()).toBe("https://api.openai.com/v1/responsesx")
  })

  it("does not rewrite non-OpenAI hosts", () => {
    const rewritten = rewriteUrl("https://example.com/v1/responses")
    expect(rewritten.toString()).toBe("https://example.com/v1/responses")
  })
})
