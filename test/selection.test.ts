import { describe, expect, it } from "vitest"

import { selectAccount } from "../lib/rotation"
import type { AccountRecord } from "../lib/types"

describe("selection", () => {
  it("never selects enabled: false accounts", () => {
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: false, lastUsed: 999 },
      { identityKey: "b", enabled: true, lastUsed: 1 }
    ]

    const selected = selectAccount({
      accounts,
      strategy: "sticky",
      activeIdentityKey: "a",
      now: 1000
    })

    expect(selected?.identityKey).toBe("b")
  })
})
