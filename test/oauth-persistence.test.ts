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
      expect(domain).toBeTruthy()
      if (!domain) throw new Error("expected codex oauth domain")
      expect(domain.accounts).toHaveLength(1)

      const account = domain.accounts[0]
      expect(account?.refresh).toBe("refresh_token")
      expect(account?.access).toBe("access_token")
      expect(account?.accountId).toBe("acc_codex")
      expect(account?.email).toBe("codex@example.com")
      expect(account?.plan).toBe("pro")
      expect(account?.identityKey).toBeTruthy()
      expect(domain.activeIdentityKey).toBe(account?.identityKey)
    } finally {
      if (previousXdgConfigHome === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = previousXdgConfigHome
      }
    }
  })
})
