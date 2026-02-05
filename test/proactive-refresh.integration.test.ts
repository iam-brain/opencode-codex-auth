import { describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { saveAuthStorage, loadAuthStorage } from "../lib/storage"
import { runOneProactiveRefreshTick } from "../lib/proactive-refresh"

describe("proactive refresh", () => {
  it("refreshes ONLY enabled accounts nearing expiry", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-refresh-"))
    const p = path.join(dir, "auth.json")

    await saveAuthStorage(p, (cur) => ({
      ...cur,
      openai: {
        type: "oauth",
        strategy: "round_robin",
        activeIdentityKey: "a",
        accounts: [
          { identityKey: "a", enabled: true, refresh: "ra", access: "oldA", expires: 50_000, accountId: "1", email: "a@example.com", plan: "plus" },
          { identityKey: "b", enabled: false, refresh: "rb", access: "oldB", expires: 50_000, accountId: "2", email: "b@example.com", plan: "plus" }
        ]
      }
    }))

    const refresh = vi.fn(async (refreshToken: string) => ({
      access: "newA",
      refresh: refreshToken,
      expires: 999_999
    }))

    await runOneProactiveRefreshTick({
      authPath: p,
      now: () => 60_000,
      bufferMs: 10_000,
      refresh
    })

    const stored = await loadAuthStorage(p)
    const openai = stored.openai
    if (!openai || !("accounts" in openai)) throw new Error("missing")
    
    const accountA = openai.accounts.find(a => a.identityKey === "a")
    const accountB = openai.accounts.find(a => a.identityKey === "b")

    expect(accountA?.access).toBe("newA")
    expect(accountB?.access).toBe("oldB")
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith("ra")
  })
})
