import { describe, expect, it } from "vitest"

import { selectAccount } from "../lib/rotation"
import type { AccountRecord } from "../lib/types"

describe("rotation", () => {
  it("round_robin moves from a to b", () => {
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: true },
      { identityKey: "b", enabled: true }
    ]

    const selected = selectAccount({
      accounts,
      strategy: "round_robin",
      activeIdentityKey: "a",
      now: Date.now()
    })

    expect(selected?.identityKey).toBe("b")
  })

  it("sticky keeps active", () => {
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: true },
      { identityKey: "b", enabled: true }
    ]

    const selected = selectAccount({
      accounts,
      strategy: "sticky",
      activeIdentityKey: "a",
      now: Date.now()
    })

    expect(selected?.identityKey).toBe("a")
  })

  it("hybrid picks most recently used when active missing", () => {
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: true, lastUsed: 100 },
      { identityKey: "b", enabled: true, lastUsed: 200 }
    ]

    const selected = selectAccount({
      accounts,
      strategy: "hybrid",
      activeIdentityKey: "missing",
      now: Date.now()
    })

    expect(selected?.identityKey).toBe("b")
  })

  it("skips disabled accounts (including active)", () => {
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: false, lastUsed: 999 },
      { identityKey: "b", enabled: true, lastUsed: 1 }
    ]

    expect(
      selectAccount({
        accounts,
        strategy: "sticky",
        activeIdentityKey: "a",
        now: Date.now()
      })?.identityKey
    ).toBe("b")

    expect(
      selectAccount({
        accounts,
        strategy: "hybrid",
        activeIdentityKey: "missing",
        now: Date.now()
      })?.identityKey
    ).toBe("b")
  })
})
