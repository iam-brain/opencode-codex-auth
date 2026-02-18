import { describe, expect, it } from "vitest"

import { switchedAccountMessage, toggledAccountMessage } from "../lib/auth-messages"

describe("tools output", () => {
  it("formats a switch message", () => {
    expect(switchedAccountMessage({ email: "u@e.com", plan: "plus", index1: 2 })).toContain("2")
  })

  it("formats toggle message for targeted row state", () => {
    expect(
      toggledAccountMessage({
        index1: 2,
        email: "second@example.com",
        plan: "plus",
        enabled: false
      })
    ).toBe("Updated #2: second@example.com (plus) -> disabled")
  })
})
