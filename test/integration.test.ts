import { describe, expect, it } from "vitest"

import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { selectAccount } from "../lib/rotation"
import { loadAuthStorage } from "../lib/storage"

describe("integration", () => {
  it("hybrid prefers least recently used when activeIdentityKey is missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-auth-"))
    const filePath = path.join(dir, "auth.json")
    await writeFile(
      filePath,
      `${JSON.stringify(
        {
          openai: {
            type: "oauth",
            strategy: "hybrid",
            accounts: [
              { identityKey: "a", enabled: true, lastUsed: 1 },
              { identityKey: "b", enabled: true, lastUsed: 2 }
            ]
          }
        },
        null,
        2
      )}\n`,
      { mode: 0o600 }
    )

    const auth = await loadAuthStorage(filePath)
    const openai = auth.openai
    if (!openai || openai.type !== "oauth" || !("accounts" in openai)) {
      throw new Error("Expected openai multi-account oauth auth")
    }

    const now = 1_000
    const selected = selectAccount({
      accounts: openai.accounts,
      strategy: "hybrid",
      now
    })

    expect(selected?.identityKey).toBe("a")
  })
})
