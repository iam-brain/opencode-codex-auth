import { describe, expect, it } from "vitest"

import { upsertAccount } from "../lib/codex-native"
import type { OpenAIMultiOauthAuth } from "../lib/types"

describe("upsertAccount", () => {
  it("creates a new account when identity-defining fields imply a different identityKey", () => {
    const openai: OpenAIMultiOauthAuth = {
      type: "oauth",
      accounts: [
        {
          identityKey: "acc_1|old@example.com|plus",
          enabled: true,
          refresh: "shared-refresh",
          access: "old-access",
          expires: 1,
          accountId: "acc_1",
          email: "old@example.com",
          plan: "plus"
        }
      ],
      activeIdentityKey: "acc_1|old@example.com|plus"
    }

    const stored = upsertAccount(openai, {
      enabled: true,
      refresh: "shared-refresh",
      access: "new-access",
      expires: 2,
      accountId: "acc_1",
      email: "new@example.com",
      plan: "pro"
    })

    expect(openai.accounts).toHaveLength(2)
    const original = openai.accounts.find(
      (account) => account.identityKey === "acc_1|old@example.com|plus"
    )
    expect(original?.email).toBe("old@example.com")
    expect(original?.plan).toBe("plus")
    expect(original?.identityKey).toBe("acc_1|old@example.com|plus")
    expect(stored.identityKey).toBe("acc_1|new@example.com|pro")
    expect(
      openai.accounts.some(
        (account) => account.identityKey === "acc_1|new@example.com|pro"
      )
    ).toBe(true)
  })
})
