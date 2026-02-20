import { describe, expect, it } from "vitest"

import { formatToastMessage } from "../lib/toast"

describe("toast formatting", () => {
  it("normalizes whitespace", () => {
    expect(formatToastMessage("  hello    world  ")).toBe("hello world")
  })

  it("truncates long path-like tokens", () => {
    const message = "Path /Users/example/really/long/path/with/very/very/very/very/long/segment/file.json"
    const formatted = formatToastMessage(message)
    expect(formatted.length).toBeLessThanOrEqual(160)
    expect(formatted.includes("…")).toBe(true)
  })

  it("removes bracketed reason codes from toast text", () => {
    expect(formatToastMessage("Rate limited - switching account [retry_pending_after_429]")).toBe(
      "Rate limited - switching account"
    )
  })
})
