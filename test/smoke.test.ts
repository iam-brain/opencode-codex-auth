import { describe, expect, it } from "vitest"
import plugin, { OpenAIMultiAuthPlugin } from "../index"

describe("smoke", () => {
  it("exports plugin entrypoints", () => {
    expect(typeof plugin).toBe("function")
    expect(plugin).toBe(OpenAIMultiAuthPlugin)
  })
})
