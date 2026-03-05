import { describe, expect, it } from "vitest"

import { transformOutboundRequestPayload } from "../lib/codex-native/request-transform.js"

describe("request transform service tier + compat integration", () => {
  it("preserves service_tier injection when compat sanitization also rewrites the payload", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        input: [
          {
            type: "function_call_output",
            output: "tool output"
          }
        ]
      })
    })

    const transformed = await transformOutboundRequestPayload({
      request,
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: true,
      promptCacheKeyOverrideEnabled: false,
      behaviorSettings: {
        global: {
          serviceTier: "priority"
        }
      }
    })

    const body = JSON.parse(await transformed.request.text()) as {
      service_tier?: string
      input?: Array<Record<string, unknown>>
    }

    expect(transformed.changed).toBe(true)
    expect(transformed.compatSanitizer.changed).toBe(true)
    expect(transformed.serviceTier.changed).toBe(true)
    expect(body.service_tier).toBe("priority")
    expect(body.input?.[0]?.type).toBe("message")
    expect(body.input?.[0]?.role).toBe("assistant")
    expect(body.input?.[0]?.content).toEqual([{ type: "output_text", text: "tool output" }])
  })
})
