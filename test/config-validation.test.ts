import { describe, expect, it } from "vitest"

import { validateConfigFileObject } from "../lib/config"

describe("config validation", () => {
  it("returns actionable issues for invalid known fields", () => {
    const result = validateConfigFileObject({
      runtime: {
        promptCacheKeyStrategy: "bad"
      },
      global: {
        serviceTier: "turbo"
      }
    })

    expect(result.valid).toBe(false)
    expect(result.issues[0]).toContain("runtime.promptCacheKeyStrategy")
    expect(result.issues[1]).toContain("global.serviceTier")
  })
})
