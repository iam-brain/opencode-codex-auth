import { describe, expect, it } from "vitest"

import { listAccountsForTools } from "../lib/accounts-tools"

describe("accounts-tools listing", () => {
  it("returns a stable list with 1-based display index", () => {
    const openai = {
      type: "oauth" as const,
      activeIdentityKey: "b|u@e.com|plus",
      accounts: [
        { identityKey: "a|u@e.com|plus", email: "u@e.com", plan: "plus", enabled: true },
        { identityKey: "b|u@e.com|plus", email: "u2@e.com", plan: "plus", enabled: false }
      ]
    }
    const rows = listAccountsForTools(openai)
    expect(rows[0]?.displayIndex).toBe(1)
    expect(rows[1]?.displayIndex).toBe(2)
    expect(rows[1]?.enabled).toBe(false)
  })
})
