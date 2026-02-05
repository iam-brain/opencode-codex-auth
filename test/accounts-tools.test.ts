import { describe, expect, it } from "vitest"

import { listAccountsForTools, removeAccountByIndex, switchAccountByIndex, toggleAccountEnabledByIndex } from "../lib/accounts-tools"

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

describe("removeAccountByIndex", () => {
  it("removes account and updates activeIdentityKey when active was removed", () => {
    const openai = {
      type: "oauth" as const,
      activeIdentityKey: "b",
      accounts: [
        { identityKey: "a", enabled: true },
        { identityKey: "b", enabled: true },
        { identityKey: "c", enabled: true }
      ]
    }
    const next = removeAccountByIndex(openai, 2)
    expect(next.accounts.map(a => a.identityKey)).toEqual(["a", "c"])
    expect(next.activeIdentityKey).toBe("c")
  })

  it("clears activeIdentityKey if last account removed", () => {
    const openai = { type: "oauth" as const, activeIdentityKey: "a", accounts: [{ identityKey: "a", enabled: true }] }
    const next = removeAccountByIndex(openai, 1)
    expect(next.accounts.length).toBe(0)
    expect(next.activeIdentityKey).toBeUndefined()
  })

  it("rejects non-integer indices", () => {
    const openai = { type: "oauth" as const, accounts: [{ identityKey: "a", enabled: true }] }
    expect(() => removeAccountByIndex(openai, 1.2)).toThrow("Invalid account index")
  })
})
