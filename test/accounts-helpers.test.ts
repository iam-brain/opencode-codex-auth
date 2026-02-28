import { describe, expect, it } from "vitest"

import {
  buildAuthMenuAccounts,
  findDomainAccountIndex,
  reconcileActiveIdentityKey
} from "../lib/codex-native/accounts"
import type { OpenAIOAuthDomain } from "../lib/types"

describe("codex-native account helpers", () => {
  it("findDomainAccountIndex falls back to strict tuple when identity key is missing", () => {
    const domain: OpenAIOAuthDomain = {
      accounts: [
        {
          accountId: "acc_1",
          email: "one@example.com",
          plan: "plus",
          enabled: true,
          refresh: "rt_1"
        },
        {
          accountId: "acc_2",
          email: "two@example.com",
          plan: "pro",
          enabled: true,
          refresh: "rt_2"
        }
      ]
    }

    const index = findDomainAccountIndex(domain, {
      index: 0,
      accountId: "acc_2",
      email: "two@example.com",
      plan: "pro",
      enabled: true,
      authTypes: ["native"],
      status: "unknown",
      isCurrentAccount: false
    })

    expect(index).toBe(1)
  })

  it("reconcileActiveIdentityKey clears stale active identity and selects enabled fallback", () => {
    const domain: OpenAIOAuthDomain = {
      activeIdentityKey: "missing|user@example.com|plus",
      accounts: [
        {
          identityKey: "acc_1|one@example.com|plus",
          enabled: false,
          refresh: "rt_1"
        },
        {
          identityKey: "acc_2|two@example.com|pro",
          enabled: true,
          refresh: "rt_2"
        }
      ]
    }

    reconcileActiveIdentityKey(domain)
    expect(domain.activeIdentityKey).toBe("acc_2|two@example.com|pro")
  })

  it("buildAuthMenuAccounts keeps deterministic rows for identityless duplicates across modes", () => {
    const native: OpenAIOAuthDomain = {
      accounts: [
        {
          accountId: "acc_native",
          email: "shared@example.com",
          plan: "plus",
          enabled: true,
          refresh: "rt_native",
          lastUsed: 100
        }
      ]
    }

    const codex: OpenAIOAuthDomain = {
      accounts: [
        {
          accountId: "acc_codex",
          email: "shared@example.com",
          plan: "plus",
          enabled: true,
          refresh: "rt_codex",
          lastUsed: 200
        }
      ]
    }

    const rows = buildAuthMenuAccounts({ native, codex, activeMode: "native" })

    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((row) => row.index))).toEqual(new Set([0, 1]))
    expect(rows.every((row) => row.authTypes?.length === 1)).toBe(true)
  })
})
