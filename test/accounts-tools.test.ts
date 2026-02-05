import { describe, expect, it } from "vitest"

import { listAccountsForTools, switchAccountByIndex, toggleAccountEnabledByIndex } from "../lib/accounts-tools"

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

describe("switchAccountByIndex", () => {
  it("sets activeIdentityKey to the target account identityKey", () => {
    const openai = {
      type: "oauth" as const,
      activeIdentityKey: "a",
      accounts: [
        { identityKey: "a", enabled: true },
        { identityKey: "b", enabled: true }
      ]
    }
    const next = switchAccountByIndex(openai, 2)
    expect(next.activeIdentityKey).toBe("b")
  })

  it("rejects invalid indices", () => {
    const openai = { type: "oauth" as const, accounts: [{ identityKey: "a", enabled: true }] }
    expect(() => switchAccountByIndex(openai, 0)).toThrow()
    expect(() => switchAccountByIndex(openai, 2)).toThrow()
    expect(() => switchAccountByIndex(openai, 1.1)).toThrow()
    expect(() => switchAccountByIndex(openai, Number.NaN)).toThrow()
    expect(() => switchAccountByIndex(openai, Number.POSITIVE_INFINITY)).toThrow()
  })
})

describe("toggleAccountEnabledByIndex", () => {
  it("toggles enabled flag for the target account", () => {
    const openai = {
      type: "oauth" as const,
      activeIdentityKey: "a",
      accounts: [
        { identityKey: "a", enabled: true },
        { identityKey: "b", enabled: false }
      ]
    }
    const next = toggleAccountEnabledByIndex(openai, 2)
    expect(next.accounts[0]?.enabled).toBe(true)
    expect(next.accounts[1]?.enabled).toBe(true)

    const next2 = toggleAccountEnabledByIndex(next, 1)
    expect(next2.accounts[0]?.enabled).toBe(false)
  })

  it("rejects non-integer indices", () => {
    const openai = {
      type: "oauth" as const,
      accounts: [{ identityKey: "a", enabled: true }]
    }
    expect(() => toggleAccountEnabledByIndex(openai, 1.5)).toThrow("Invalid account index")
  })
})
