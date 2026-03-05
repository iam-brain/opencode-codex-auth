import { describe, expect, it } from "vitest"

import type { BehaviorSettings } from "../lib/config.js"
import {
  sanitizeOutboundRequestIfNeeded,
  transformOutboundRequestPayload
} from "../lib/codex-native/request-transform.js"

const PRIORITY_BEHAVIOR_SETTINGS: BehaviorSettings = {
  global: {
    serviceTier: "priority"
  }
}

describe("GPT-5.4 long-context request clamps", () => {
  it("preserves valid 1M-context fields while still injecting service_tier priority", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        model_context_window: 1_000_000,
        model_auto_compact_token_limit: 872_000,
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }]
      })
    })

    const transformed = await transformOutboundRequestPayload({
      request,
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false,
      behaviorSettings: PRIORITY_BEHAVIOR_SETTINGS
    })

    const body = JSON.parse(await transformed.request.text()) as {
      service_tier?: string
      model_context_window?: number
      model_auto_compact_token_limit?: number
    }

    expect(transformed.changed).toBe(true)
    expect(transformed.serviceTier.changed).toBe(true)
    expect(transformed.serviceTier.reason).toBe("updated")
    expect(body.service_tier).toBe("priority")
    expect(body.model_context_window).toBe(1_000_000)
    expect(body.model_auto_compact_token_limit).toBe(872_000)
  })

  it("clamps GPT-5.4 long-context overrides to documented request limits", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-5.4",
        model_context_window: 2_000_000,
        model_auto_compact_token_limit: 2_000_000,
        max_output_tokens: 200_000,
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }]
      })
    })

    const transformed = await transformOutboundRequestPayload({
      request,
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false,
      behaviorSettings: PRIORITY_BEHAVIOR_SETTINGS
    })

    const body = JSON.parse(await transformed.request.text()) as {
      service_tier?: string
      model_context_window?: number
      model_auto_compact_token_limit?: number
      max_output_tokens?: number
    }

    expect(transformed.changed).toBe(true)
    expect(transformed.serviceTier.changed).toBe(true)
    expect(transformed.serviceTier.reason).toBe("updated")
    expect(body.service_tier).toBe("priority")
    expect(body.model_context_window).toBe(1_050_000)
    expect(body.model_auto_compact_token_limit).toBe(922_000)
    expect(body.max_output_tokens).toBe(128_000)
  })

  it("reserves output headroom when a smaller GPT-5.4 context window is requested", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        model_context_window: 300_000,
        model_auto_compact_token_limit: 300_000,
        max_output_tokens: 128_000,
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }]
      })
    })

    const transformed = await transformOutboundRequestPayload({
      request,
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false,
      behaviorSettings: PRIORITY_BEHAVIOR_SETTINGS
    })

    const body = JSON.parse(await transformed.request.text()) as {
      model_context_window?: number
      model_auto_compact_token_limit?: number
      max_output_tokens?: number
    }

    expect(transformed.changed).toBe(true)
    expect(body.model_context_window).toBe(300_000)
    expect(body.model_auto_compact_token_limit).toBe(172_000)
    expect(body.max_output_tokens).toBe(128_000)
  })

  it("keeps wrapper transforms scoped instead of silently applying GPT-5.4 clamps", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        model_context_window: 2_000_000,
        model_auto_compact_token_limit: 2_000_000,
        max_output_tokens: 200_000,
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }]
      })
    })

    const transformed = await sanitizeOutboundRequestIfNeeded(request, false)
    const body = JSON.parse(await transformed.request.text()) as {
      model_context_window?: number
      model_auto_compact_token_limit?: number
      max_output_tokens?: number
    }

    expect(transformed.changed).toBe(false)
    expect(body.model_context_window).toBe(2_000_000)
    expect(body.model_auto_compact_token_limit).toBe(2_000_000)
    expect(body.max_output_tokens).toBe(200_000)
  })
})
