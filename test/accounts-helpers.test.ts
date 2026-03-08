import { describe, expect, it } from "vitest"

import {
  buildAuthMenuAccounts,
  ensureAccountAuthTypes,
  findDomainAccountIndex,
  formatAccountLabel,
  hydrateAccountIdentityFromAccessClaims,
  reconcileActiveIdentityKey
} from "../lib/codex-native/accounts"
import type { AccountRecord, OpenAIOAuthDomain } from "../lib/types"

function buildJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.sig`
}

describe("codex-native account helpers", () => {
  it("formats account labels from email, plan, id suffix, or positional fallback", () => {
    expect(formatAccountLabel({ email: "one@example.com", plan: "plus" }, 0)).toBe("one@example.com (plus)")
    expect(formatAccountLabel({ email: "one@example.com" }, 1)).toBe("one@example.com")
    expect(formatAccountLabel({ accountId: "acc_123456789" }, 2)).toBe("id:456789")
    expect(formatAccountLabel(undefined, 3)).toBe("Account 4")
  })

  it("normalizes account auth types in place", () => {
    const account = {
      authTypes: ["codex", "native", "codex"]
    }

    expect(ensureAccountAuthTypes(account as never)).toEqual(["native", "codex"])
    expect(account.authTypes).toEqual(["native", "codex"])
  })

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

  it("keeps same-mode identityless refresh-only accounts as separate actionable rows", () => {
    const native: OpenAIOAuthDomain = {
      accounts: [
        {
          enabled: true,
          refresh: "rt_1"
        },
        {
          enabled: true,
          refresh: "rt_2"
        }
      ]
    }

    const rows = buildAuthMenuAccounts({ native, activeMode: "native" })

    expect(rows).toHaveLength(2)
    expect(rows[0]?.sourceIndices?.native).toBe(0)
    expect(rows[1]?.sourceIndices?.native).toBe(1)
    expect(findDomainAccountIndex(native, rows[0]!)).toBe(0)
    expect(findDomainAccountIndex(native, rows[1]!)).toBe(1)
  })

  it("prefers the requested auth mode source index for merged account rows", () => {
    const native: OpenAIOAuthDomain = {
      accounts: [
        {
          identityKey: "acc_shared|user@example.com|plus",
          enabled: true,
          refresh: "rt_native_0"
        },
        {
          identityKey: "acc_other|other@example.com|plus",
          enabled: true,
          refresh: "rt_native_1"
        }
      ]
    }
    const codex: OpenAIOAuthDomain = {
      accounts: [
        {
          identityKey: "acc_other|other@example.com|plus",
          enabled: true,
          refresh: "rt_codex_0"
        },
        {
          identityKey: "acc_shared|user@example.com|plus",
          enabled: true,
          refresh: "rt_codex_1"
        }
      ]
    }

    const row = buildAuthMenuAccounts({ native, codex, activeMode: "native" }).find(
      (account) => account.identityKey === "acc_shared|user@example.com|plus"
    )

    expect(row).toBeDefined()
    expect(findDomainAccountIndex(native, row!, "native")).toBe(0)
    expect(findDomainAccountIndex(codex, row!, "codex")).toBe(1)
  })

  it("revalidates stored source indices before using them", () => {
    const domain: OpenAIOAuthDomain = {
      accounts: [
        {
          identityKey: "acc_other|other@example.com|plus",
          accountId: "acc_other",
          email: "other@example.com",
          plan: "plus",
          enabled: true,
          refresh: "rt_other"
        },
        {
          identityKey: "acc_target|target@example.com|pro",
          accountId: "acc_target",
          email: "target@example.com",
          plan: "pro",
          enabled: true,
          refresh: "rt_target"
        }
      ]
    }

    const index = findDomainAccountIndex(
      domain,
      {
        index: 0,
        identityKey: "acc_target|target@example.com|pro",
        accountId: "acc_target",
        email: "target@example.com",
        plan: "pro",
        sourceIndices: { native: 0 },
        enabled: true,
        authTypes: ["native"],
        status: "unknown",
        isCurrentAccount: false
      },
      "native"
    )

    expect(index).toBe(1)
  })

  it("hydrates missing identity fields from access-token claims", () => {
    const account: AccountRecord = {
      access: buildJwt({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acc_123",
          chatgpt_plan_type: "Plus"
        },
        "https://api.openai.com/profile": {
          email: "USER@example.com"
        }
      })
    }

    hydrateAccountIdentityFromAccessClaims(account)

    expect(account.accountId).toBe("acc_123")
    expect(account.email).toBe("user@example.com")
    expect(account.plan).toBe("plus")
    expect(account.identityKey).toBe("acc_123|user@example.com|plus")
    expect(account.authTypes).toEqual(["native"])
  })

  it("marks current accounts only when the active account is enabled and surfaces cooldown status", () => {
    const native: OpenAIOAuthDomain = {
      activeIdentityKey: "acc_enabled|enabled@example.com|plus",
      accounts: [
        {
          identityKey: "acc_disabled|disabled@example.com|plus",
          enabled: false,
          expires: Date.now() - 1_000,
          refresh: "rt_disabled"
        },
        {
          identityKey: "acc_enabled|enabled@example.com|plus",
          enabled: true,
          cooldownUntil: Date.now() + 60_000,
          refresh: "rt_enabled"
        }
      ]
    }

    const rows = buildAuthMenuAccounts({ native, activeMode: "native" })
    const disabled = rows.find((row) => row.identityKey === "acc_disabled|disabled@example.com|plus")
    const enabled = rows.find((row) => row.identityKey === "acc_enabled|enabled@example.com|plus")

    expect(disabled?.isCurrentAccount).toBe(false)
    expect(disabled?.status).toBe("expired")
    expect(enabled?.isCurrentAccount).toBe(true)
    expect(enabled?.status).toBe("active")
  })
})
