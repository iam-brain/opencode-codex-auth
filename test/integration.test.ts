import { describe, expect, it } from "vitest"

import { selectAccount } from "../lib/rotation"
import type { AccountRecord } from "../lib/types"

describe("integration", () => {
  it("hybrid prefers most recently used when activeIdentityKey is missing", () => {
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: true, lastUsed: 1 },
      { identityKey: "b", enabled: true, lastUsed: 2 }
    ]

    const selected = selectAccount({
      accounts,
      strategy: "hybrid",
      now: Date.now()
    })

    expect(selected?.identityKey).toBe("b")
  })
})
