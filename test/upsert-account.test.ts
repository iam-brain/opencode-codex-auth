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
    const original = openai.accounts.find((account) => account.identityKey === "acc_1|old@example.com|plus")
    expect(original?.email).toBe("old@example.com")
    expect(original?.plan).toBe("plus")
    expect(original?.identityKey).toBe("acc_1|old@example.com|plus")
    expect(stored.identityKey).toBe("acc_1|new@example.com|pro")
    expect(openai.accounts.some((account) => account.identityKey === "acc_1|new@example.com|pro")).toBe(true)
  })

  it("uses refresh fallback without mutating identity-defining fields when strict identity is unavailable", () => {
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
      email: "new@example.com",
      plan: "pro"
    })

    expect(openai.accounts).toHaveLength(1)
    const original = openai.accounts.find((account) => account.identityKey === "acc_1|old@example.com|plus")
    expect(original?.email).toBe("old@example.com")
    expect(original?.plan).toBe("plus")
    expect(stored.identityKey).toBe("acc_1|old@example.com|plus")
    expect(stored.access).toBe("new-access")
  })

  it("does not match by accountId alone when strict identity and refresh backup both miss", () => {
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
      refresh: "different-refresh",
      access: "new-access",
      expires: 2,
      accountId: "acc_1"
    })

    expect(openai.accounts).toHaveLength(2)
    const original = openai.accounts.find((account) => account.identityKey === "acc_1|old@example.com|plus")
    expect(original?.access).toBe("old-access")
    expect(stored.identityKey).toBeUndefined()
  })

  it("does not match by raw incoming identityKey when tuple and refresh backup are unavailable", () => {
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
      identityKey: "acc_1|old@example.com|plus",
      enabled: true,
      refresh: "different-refresh",
      access: "new-access",
      expires: 2
    })

    expect(openai.accounts).toHaveLength(2)
    const original = openai.accounts.find((account) => account.identityKey === "acc_1|old@example.com|plus")
    expect(original?.access).toBe("old-access")
    expect(stored.identityKey).toBeUndefined()
  })

  it("matches disabled record by tuple to preserve unique identityKey on relogin", () => {
    const openai: OpenAIMultiOauthAuth = {
      type: "oauth",
      accounts: [
        {
          identityKey: "acc_1|user@example.com|plus",
          enabled: false,
          refresh: "old-refresh",
          access: "old-access",
          expires: 1,
          accountId: "acc_1",
          email: "user@example.com",
          plan: "plus"
        }
      ],
      activeIdentityKey: "acc_1|user@example.com|plus"
    }

    const stored = upsertAccount(openai, {
      enabled: true,
      refresh: "new-refresh",
      access: "new-access",
      expires: 2,
      accountId: "acc_1",
      email: "user@example.com",
      plan: "plus"
    })

    expect(openai.accounts).toHaveLength(1)
    expect(stored.identityKey).toBe("acc_1|user@example.com|plus")
    expect(stored.enabled).toBe(true)
    expect(stored.refresh).toBe("new-refresh")
    expect(stored.access).toBe("new-access")
  })
})
