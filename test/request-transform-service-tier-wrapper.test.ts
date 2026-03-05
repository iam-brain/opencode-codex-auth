import { describe, expect, it } from "vitest"

import { applyServiceTierOverrideToRequest } from "../lib/codex-native/request-transform.js"

describe("request transform service tier wrapper", () => {
  it("applies the shared payload service-tier transform", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }]
      })
    })

    const transformed = await applyServiceTierOverrideToRequest({
      request,
      behaviorSettings: {
        global: {
          serviceTier: "priority"
        }
      }
    })

    const body = JSON.parse(await transformed.request.text()) as { service_tier?: string }

    expect(transformed.changed).toBe(true)
    expect(transformed.reason).toBe("updated")
    expect(transformed.serviceTier).toBe("priority")
    expect(body.service_tier).toBe("priority")
  })
})
