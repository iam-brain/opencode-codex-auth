import { describe, expect, it } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { ensureOpenAIOAuthDomain, loadAuthStorage, saveAuthStorage } from "../lib/storage"
import { runOneProactiveRefreshTick } from "../lib/proactive-refresh"
import type { AccountRecord } from "../lib/types"

describe("proactive refresh lease ownership", () => {
  it("ignores refresh success when refresh token changes after claim", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-refresh-lock-"))
    const authPath = path.join(dir, "auth.json")

    await saveAuthStorage(authPath, (auth) => ({
      ...auth,
      openai: {
        type: "oauth",
        strategy: "round_robin",
        accounts: [
          {
            identityKey: "acc|one@example.com|plus",
            accountId: "acc",
            email: "one@example.com",
            plan: "plus",
            enabled: true,
            refresh: "rt_old",
            access: "at_old",
            expires: 0
          }
        ]
      }
    }))

    await runOneProactiveRefreshTick({
      authPath,
      now: () => 1_000,
      bufferMs: 10_000,
      refresh: async () => {
        await saveAuthStorage(authPath, (auth) => {
          const domain = ensureOpenAIOAuthDomain(auth, "native")
          const target = domain.accounts.find((account: AccountRecord) => account.identityKey === "acc|one@example.com|plus")
          if (target) {
            target.refresh = "rt_newer"
          }
          return auth
        })
        return {
          access: "at_new",
          refresh: "rt_new",
          expires: 9_999
        }
      }
    })

    const stored = await loadAuthStorage(authPath)
    const openai = stored.openai
    if (!openai || openai.type !== "oauth" || !("accounts" in openai)) throw new Error("missing openai auth")
    const account = openai.accounts.find((entry: AccountRecord) => entry.identityKey === "acc|one@example.com|plus")

    expect(account?.refresh).toBe("rt_newer")
    expect(account?.access).toBe("at_old")
    expect(account?.enabled).toBe(true)
    expect(account?.refreshLeaseUntil).toBeUndefined()
  })

  it("does not disable account on invalid_grant from stale claim", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-refresh-lock-"))
    const authPath = path.join(dir, "auth.json")

    await saveAuthStorage(authPath, (auth) => ({
      ...auth,
      openai: {
        type: "oauth",
        strategy: "round_robin",
        accounts: [
          {
            identityKey: "acc|one@example.com|plus",
            accountId: "acc",
            email: "one@example.com",
            plan: "plus",
            enabled: true,
            refresh: "rt_old",
            access: "at_old",
            expires: 0
          }
        ]
      }
    }))

    await runOneProactiveRefreshTick({
      authPath,
      now: () => 1_000,
      bufferMs: 10_000,
      refresh: async () => {
        await saveAuthStorage(authPath, (auth) => {
          const domain = ensureOpenAIOAuthDomain(auth, "native")
          const target = domain.accounts.find((account: AccountRecord) => account.identityKey === "acc|one@example.com|plus")
          if (target) {
            target.refresh = "rt_newer"
          }
          return auth
        })
        const error = new Error("Token refresh failed (invalid_grant)")
        ;(error as Error & { oauthCode?: string }).oauthCode = "invalid_grant"
        throw error
      }
    })

    const stored = await loadAuthStorage(authPath)
    const openai = stored.openai
    if (!openai || openai.type !== "oauth" || !("accounts" in openai)) throw new Error("missing openai auth")
    const account = openai.accounts.find((entry: AccountRecord) => entry.identityKey === "acc|one@example.com|plus")

    expect(account?.enabled).toBe(true)
    expect(account?.refresh).toBe("rt_newer")
    expect(account?.refreshLeaseUntil).toBeUndefined()
    expect(account?.cooldownUntil).toBeUndefined()
  })
})
