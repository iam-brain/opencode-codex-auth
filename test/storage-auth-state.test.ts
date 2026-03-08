import { describe, expect, it } from "vitest"

import { normalizeOpenAIOAuthState } from "../lib/storage/auth-state.js"

function buildJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.sig`
}

describe("storage auth-state normalization", () => {
  it("merges native and codex accounts by identity and freshness", () => {
    const openai = normalizeOpenAIOAuthState({
      type: "oauth",
      accounts: [],
      native: {
        accounts: [
          {
            access: buildJwt({
              "https://api.openai.com/auth": {
                chatgpt_account_id: "acc_123",
                chatgpt_plan_type: "plus"
              },
              "https://api.openai.com/profile": {
                email: "user@example.com"
              }
            }),
            refresh: "rt_native",
            expires: 1_000,
            authTypes: ["native"],
            enabled: true
          }
        ],
        activeIdentityKey: "acc_123|user@example.com|plus"
      },
      codex: {
        accounts: [
          {
            access: buildJwt({
              "https://api.openai.com/auth": {
                chatgpt_account_id: "acc_123",
                chatgpt_plan_type: "plus"
              },
              "https://api.openai.com/profile": {
                email: "user@example.com"
              }
            }),
            refresh: "rt_codex",
            expires: 2_000,
            authTypes: ["codex"],
            enabled: false
          }
        ],
        activeIdentityKey: "acc_123|user@example.com|plus"
      }
    } as never)

    expect(openai.accounts).toHaveLength(1)
    expect(openai.accounts[0]?.identityKey).toBe("acc_123|user@example.com|plus")
    expect(openai.accounts[0]?.refresh).toBe("rt_codex")
    expect(openai.accounts[0]?.expires).toBe(2_000)
    expect(openai.accounts[0]?.enabled).toBe(true)
    expect(openai.accounts[0]?.authTypes).toEqual(["native", "codex"])
  })

  it("falls back active identity to the first enabled merged account", () => {
    const openai = normalizeOpenAIOAuthState({
      type: "oauth",
      accounts: [],
      native: {
        accounts: [
          {
            accountId: "acc_1",
            email: "one@example.com",
            plan: "plus",
            access: "at_1",
            refresh: "rt_1",
            expires: 1_000,
            enabled: false,
            authTypes: ["native"]
          },
          {
            accountId: "acc_2",
            email: "two@example.com",
            plan: "pro",
            access: "at_2",
            refresh: "rt_2",
            expires: 2_000,
            enabled: true,
            authTypes: ["native"]
          }
        ],
        activeIdentityKey: "missing|identity|key"
      }
    } as never)

    expect(openai.activeIdentityKey).toBe("acc_2|two@example.com|pro")
  })

  it("assigns deterministic fallback identities when strict identity is unavailable", () => {
    const openai = normalizeOpenAIOAuthState({
      type: "oauth",
      accounts: [],
      native: {
        accounts: [
          {
            email: "one@example.com",
            plan: "plus",
            access: "at_1",
            refresh: "rt_1",
            expires: 1_000,
            enabled: true,
            authTypes: ["native"]
          },
          {
            email: "two@example.com",
            plan: "plus",
            access: "at_2",
            refresh: "rt_2",
            expires: 2_000,
            enabled: true,
            authTypes: ["native"]
          }
        ]
      }
    } as never)

    expect(openai.accounts.map((account) => account.identityKey)).toEqual([
      "legacy|_|one%40example.com|plus",
      "legacy|_|two%40example.com|plus"
    ])
  })
})
