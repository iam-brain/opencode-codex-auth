import { describe, expect, it } from "vitest"
import { parseRetryAfterMs } from "../lib/rate-limit"

describe("rate-limit", () => {
  it("parses Retry-After seconds", () => {
    const ms = parseRetryAfterMs({ "retry-after": "10" }, 1000)
    expect(ms).toBe(10_000)
  })

  it("parses Retry-After HTTP date", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z")
    const retryAt = "Wed, 01 Jan 2026 00:00:05 GMT"
    const ms = parseRetryAfterMs({ "retry-after": retryAt }, now)
    expect(ms).toBe(5_000)
  })

  it("returns undefined when missing/invalid", () => {
    expect(parseRetryAfterMs({}, 0)).toBeUndefined()
    expect(parseRetryAfterMs({ "retry-after": "nope" }, 0)).toBeUndefined()
  })

  it("handles case-insensitive headers and trimmed values", () => {
    // Case-insensitive header
    expect(parseRetryAfterMs({ "RETRY-AFTER": "5" }, 1000)).toBe(5000)
    // Trimmed value
    expect(parseRetryAfterMs({ "retry-after": "  10  " }, 1000)).toBe(10000)
  })

  it("rejects fractional numeric seconds", () => {
    expect(parseRetryAfterMs({ "retry-after": "1.5" }, 1000)).toBeUndefined()
    expect(parseRetryAfterMs({ "retry-after": "10.0" }, 1000)).toBeUndefined()
  })

  it("rejects negative numeric seconds", () => {
    expect(parseRetryAfterMs({ "retry-after": "-5" }, 1000)).toBeUndefined()
  })

  it("clamps past HTTP-date to 0", () => {
    const now = Date.parse("2026-01-01T00:00:10.000Z")
    const pastRetryAt = "Wed, 01 Jan 2026 00:00:05 GMT"
    const ms = parseRetryAfterMs({ "retry-after": pastRetryAt }, now)
    expect(ms).toBe(0)
  })
})
