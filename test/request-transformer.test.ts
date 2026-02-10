import { describe, expect, it } from "vitest"

import { sanitizeRequestPayloadForCompat } from "../lib/compat-sanitizer"

describe("request transformer compatibility bridge", () => {
  it("returns unchanged payload when input is not an array", () => {
    const payload = {
      model: "gpt-5.3-codex",
      input: { type: "message", role: "user", content: "hello" }
    }

    const result = sanitizeRequestPayloadForCompat(payload)
    expect(result.changed).toBe(false)
    expect(result.payload).toEqual(payload)
  })

  it("normalizes orphaned tool_result objects to assistant output_text", () => {
    const payload = {
      input: [
        {
          type: "tool_result",
          output: {
            status: "ok",
            value: 7
          }
        }
      ]
    }

    const result = sanitizeRequestPayloadForCompat(payload)
    expect(result.changed).toBe(true)
    expect(result.payload.input).toEqual([
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "{\"status\":\"ok\",\"value\":7}" }]
      }
    ])
  })

  it("preserves tool outputs when tool_call_id is present", () => {
    const payload = {
      input: [
        {
          type: "tool_output",
          tool_call_id: "call_987",
          output: "ok"
        }
      ]
    }

    const result = sanitizeRequestPayloadForCompat(payload)
    expect(result.changed).toBe(false)
    expect(result.payload).toEqual(payload)
  })
})
