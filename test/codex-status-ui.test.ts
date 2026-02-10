import { describe, expect, it } from "vitest"

import { renderDashboard } from "../lib/codex-status-ui"

describe("codex status ui", () => {
  it("renders one account block", () => {
    const now = Date.now()
    const out = renderDashboard({
      accounts: [{ identityKey: "acc|u@e.com|plus", email: "u@e.com", plan: "plus", enabled: true }],
      activeIdentityKey: "acc|u@e.com|plus",
      snapshots: {
        "acc|u@e.com|plus": {
          updatedAt: now,
          modelFamily: "gpt-5.2",
          limits: [
            { name: "requests", leftPct: 50, resetsAt: now + 60_000 },
            { name: "tokens", leftPct: 80, resetsAt: now + 120_000 }
          ],
          credits: { unlimited: true }
        }
      }
    })
    const text = out.join("\n")
    expect(text).toContain("u@e.com")
    expect(text).toContain("50%")
    expect(text).toContain("[")
    expect(text).toContain("█")
    expect(text).toContain("░")
    expect(text).toContain("5h")
    expect(text).toContain("Weekly")
    expect(text).toContain("(resets")
    expect(text).toContain("Credits")
    expect(text).toContain("unlimited")
  })

  it("renders fallback bars and unknown reset when snapshot is missing", () => {
    const out = renderDashboard({
      accounts: [
        {
          identityKey: "acc|u@e.com|plus",
          email: "u@e.com",
          plan: "plus",
          enabled: true,
          expires: Date.now() - 1_000
        }
      ],
      activeIdentityKey: "acc|u@e.com|plus",
      snapshots: {}
    })
    const text = out.join("\n")
    expect(text).toContain("5h")
    expect(text).toContain("Weekly")
    expect(text).toContain("0% left")
    expect(text).toContain("Unknown, account expired")
    expect(text).toContain("Credits")
  })
})
