import { describe, expect, it } from "vitest"

import { renderDashboard } from "../lib/codex-status-ui"

describe("codex status ui", () => {
  it("renders one account block", () => {
    const now = Date.now()
    const out = renderDashboard(
      {
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
      },
      { style: "menu", useColor: false }
    )
    const text = out.join("\n")
    expect(text).toContain("┌")
    expect(text).toContain("│")
    expect(text).toContain("└")
    expect(text).toContain("u@e.com")
    expect(text).toContain("[enabled]")
    expect(text).toContain("[last active]")
    expect(text).toContain("50%")
    expect(text).toContain("[")
    expect(text).toContain("█")
    expect(text).toContain("░")
    expect(text).toContain("5h")
    expect(text).toContain("Weekly")
    expect(text).toContain("(resets")
    expect(text).toContain("Credits")
    expect(text).toContain("unlimited")
    expect(text).not.toContain("│\n└")
    expect(text).not.toContain("\n\n└")
  })

  it("renders fallback bars and unknown reset when snapshot is missing", () => {
    const out = renderDashboard(
      {
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
      },
      { useColor: false }
    )
    const text = out.join("\n")
    expect(text).toContain("Codex quotas")
    expect(text).toContain("5h")
    expect(text).toContain("Weekly")
    expect(text).toContain("0% left")
    expect(text).toContain("Unknown, account expired")
    expect(text).toContain("Credits")
  })

  it("does not display a weekly-only snapshot as the 5h quota", () => {
    const now = Date.now()
    const out = renderDashboard(
      {
        accounts: [{ identityKey: "acc|u@e.com|plus", email: "u@e.com", plan: "plus", enabled: true }],
        snapshots: {
          "acc|u@e.com|plus": {
            updatedAt: now,
            modelFamily: "gpt-5.3-codex",
            limits: [{ name: "weekly", leftPct: 66, resetsAt: now + 7 * 24 * 60 * 60 * 1000 }]
          }
        }
      },
      { useColor: false }
    )

    const fiveHourLine = out.find((line) => line.includes("5h"))
    const weeklyLine = out.find((line) => line.includes("Weekly"))
    expect(fiveHourLine).toContain("0% left")
    expect(fiveHourLine).toContain("Unknown, no snapshot yet")
    expect(weeklyLine).toContain("66% left")
    expect(weeklyLine).toContain("resets")
  })
})
