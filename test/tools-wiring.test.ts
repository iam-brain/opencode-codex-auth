import { describe, expect, it } from "vitest"

import { switchToolMessage } from "../lib/tools-output"

describe("tools output", () => {
  it("formats a switch message", () => {
    expect(switchToolMessage({ email: "u@e.com", plan: "plus", index1: 2 })).toContain("2")
  })
})
