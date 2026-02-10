import { describe, expect, it } from "vitest"

import { sanitizeRequestPayloadForCompat } from "../lib/compat-sanitizer"

describe("compat sanitizer", () => {
  it("removes item_reference fields recursively", () => {
    const payload = {
      input: [
        {
          type: "message",
          role: "assistant",
          item_reference: "abc",
          content: [
            {
              type: "input_text",
              text: "hello",
              item_reference: "nested"
            }
          ]
        }
      ]
    }

    const result = sanitizeRequestPayloadForCompat(payload)
    expect(result.changed).toBe(true)
    const item = (result.payload.input as Array<Record<string, unknown>>)[0]
    expect(item.item_reference).toBeUndefined()
    const content = item.content as Array<Record<string, unknown>>
    expect(content[0].item_reference).toBeUndefined()
  })

  it("normalizes orphaned function_call_output into assistant text message", () => {
    const payload = {
      input: [
        {
          type: "function_call_output",
          output: "result body"
        }
      ]
    }

    const result = sanitizeRequestPayloadForCompat(payload)
    expect(result.changed).toBe(true)
    expect(result.payload.input).toEqual([
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "result body" }]
      }
    ])
  })

  it("keeps valid tool output items that include a call id", () => {
    const payload = {
      input: [
        {
          type: "function_call_output",
          call_id: "call_123",
          output: "ok"
        }
      ]
    }

    const result = sanitizeRequestPayloadForCompat(payload)
    expect(result.changed).toBe(false)
    expect(result.payload).toEqual(payload)
  })
})
