import { describe, expect, it } from "vitest"

import { renderDashboard } from "../lib/codex-status-ui"

describe("codex status ui", () => {
  it("renders one account block", () => {
    const out = renderDashboard({
      accounts: [{ identityKey: "acc|u@e.com|plus", email: "u@e.com", plan: "plus", enabled: true }],
      activeIdentityKey: "acc|u@e.com|plus",
      snapshots: {
        "acc|u@e.com|plus": { updatedAt: 1, modelFamily: "gpt-5.2", limits: [{ name: "requests", leftPct: 50 }] }
      }
    })
    const text = out.join("\n")
    expect(text).toContain("u@e.com")
    expect(text).toContain("50%")
  })
})
