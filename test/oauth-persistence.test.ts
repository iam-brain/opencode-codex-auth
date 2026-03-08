import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { persistOAuthTokensForMode } from "../lib/codex-native/oauth-persistence.js"
import { getOpenAIOAuthDomain, loadAuthStorage } from "../lib/storage.js"

function buildJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.${encode("sig")}`
}

describe("oauth token persistence", () => {
  it("bootstraps oauth storage from empty state on first codex login", async () => {
    const previousXdgConfigHome = process.env.XDG_CONFIG_HOME
    const root = await fs.mkdtemp(path.join(process.env.TMPDIR ?? os.tmpdir(), "oauth-persist-"))
    process.env.XDG_CONFIG_HOME = root
    try {
      const idToken = buildJwt({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acc_codex",
          chatgpt_plan_type: "pro"
        },
        "https://api.openai.com/profile": {
          email: "codex@example.com"
        }
      })

      await persistOAuthTokensForMode(
        {
          id_token: idToken,
          access_token: "access_token",
          refresh_token: "refresh_token",
          expires_in: 3600
        },
        "codex"
      )

      const auth = await loadAuthStorage()
      const domain = getOpenAIOAuthDomain(auth, "codex")
      expect(domain).toBeDefined()
      if (!domain) throw new Error("expected codex oauth domain")
      expect(domain.accounts).toHaveLength(1)

      const account = domain.accounts[0]
      expect(account?.refresh).toBe("refresh_token")
      expect(account?.access).toBe("access_token")
      expect(account?.accountId).toBe("acc_codex")
      expect(account?.email).toBe("codex@example.com")
      expect(account?.plan).toBe("pro")
      expect(account?.identityKey).toBe("acc_codex|codex@example.com|pro")
      expect(domain.activeIdentityKey).toBe("acc_codex|codex@example.com|pro")
    } finally {
      if (previousXdgConfigHome === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = previousXdgConfigHome
      }
    }
  })

  it("upgrades refresh-only imported accounts instead of duplicating them on relogin", async () => {
    const previousXdgConfigHome = process.env.XDG_CONFIG_HOME
    const root = await fs.mkdtemp(path.join(process.env.TMPDIR ?? os.tmpdir(), "oauth-persist-"))
    process.env.XDG_CONFIG_HOME = root
    try {
      const accountsPath = path.join(root, "opencode", "codex-accounts.json")
      await fs.mkdir(path.dirname(accountsPath), { recursive: true })
      await fs.writeFile(
        accountsPath,
        `${JSON.stringify(
          {
            openai: {
              type: "oauth",
              accounts: [],
              native: {
                accounts: [
                  {
                    identityKey: "legacy|_|_|_",
                    refresh: "refresh_token",
                    access: "old_access",
                    expires: Date.now() + 5_000,
                    enabled: true
                  }
                ]
              }
            }
          },
          null,
          2
        )}\n`,
        "utf8"
      )

      const idToken = buildJwt({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acc_native",
          chatgpt_plan_type: "plus"
        },
        "https://api.openai.com/profile": {
          email: "native@example.com"
        }
      })

      await persistOAuthTokensForMode(
        {
          id_token: idToken,
          access_token: "new_access",
          refresh_token: "refresh_token",
          expires_in: 3600
        },
        "native"
      )

      const auth = await loadAuthStorage()
      const domain = getOpenAIOAuthDomain(auth, "native")
      expect(domain?.accounts).toHaveLength(1)
      expect(domain?.accounts[0]?.identityKey).toBe("acc_native|native@example.com|plus")
      expect(domain?.accounts[0]?.access).toBe("new_access")
    } finally {
      if (previousXdgConfigHome === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = previousXdgConfigHome
      }
    }
  })

  it("clears refresh lease and cooldown state on successful relogin", async () => {
    const previousXdgConfigHome = process.env.XDG_CONFIG_HOME
    const root = await fs.mkdtemp(path.join(process.env.TMPDIR ?? os.tmpdir(), "oauth-persist-"))
    process.env.XDG_CONFIG_HOME = root
    try {
      const accountsPath = path.join(root, "opencode", "codex-accounts.json")
      await fs.mkdir(path.dirname(accountsPath), { recursive: true })
      await fs.writeFile(
        accountsPath,
        `${JSON.stringify(
          {
            openai: {
              type: "oauth",
              accounts: [],
              native: {
                accounts: [
                  {
                    identityKey: "acc_native|native@example.com|plus",
                    accountId: "acc_native",
                    email: "native@example.com",
                    plan: "plus",
                    refresh: "refresh_token",
                    access: "old_access",
                    expires: Date.now() + 5_000,
                    enabled: true,
                    refreshLeaseUntil: Date.now() + 30_000,
                    cooldownUntil: Date.now() + 30_000
                  }
                ],
                activeIdentityKey: "acc_native|native@example.com|plus"
              }
            }
          },
          null,
          2
        )}\n`,
        "utf8"
      )

      const idToken = buildJwt({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acc_native",
          chatgpt_plan_type: "plus"
        },
        "https://api.openai.com/profile": {
          email: "native@example.com"
        }
      })

      await persistOAuthTokensForMode(
        {
          id_token: idToken,
          access_token: "new_access",
          refresh_token: "refresh_token",
          expires_in: 3600
        },
        "native"
      )

      const auth = await loadAuthStorage()
      const domain = getOpenAIOAuthDomain(auth, "native")
      expect(domain?.accounts[0]?.refreshLeaseUntil).toBeUndefined()
      expect(domain?.accounts[0]?.cooldownUntil).toBeUndefined()
      expect(domain?.accounts[0]?.access).toBe("new_access")
    } finally {
      if (previousXdgConfigHome === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = previousXdgConfigHome
      }
    }
  })
})
