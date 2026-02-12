import { describe, expect, it } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { setAccountCooldown, loadAuthStorage } from "../lib/storage"

describe("setAccountCooldown", () => {
  it("persists cooldownUntil for enabled account", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-storage-cooldown-"))
    const p = path.join(dir, "auth.json")

    await fs.writeFile(
      p,
      JSON.stringify({
        openai: {
          type: "oauth",
          accounts: [{ identityKey: "acc1", enabled: true, refresh: "r1", access: "a1", expires: 1 }],
          activeIdentityKey: "acc1"
        }
      })
    )

    await setAccountCooldown(p, "acc1", 123456789)

    const stored = await loadAuthStorage(p)
    const openai = stored.openai
    if (!openai || !("accounts" in openai)) throw new Error("missing accounts")

    const acc = openai.accounts.find((a) => a.identityKey === "acc1")
    expect(acc?.cooldownUntil).toBe(123456789)
  })

  it("does not mutate disabled accounts", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-storage-cooldown-disabled-"))
    const p = path.join(dir, "auth.json")

    await fs.writeFile(
      p,
      JSON.stringify({
        openai: {
          type: "oauth",
          accounts: [{ identityKey: "acc-disabled", enabled: false, refresh: "r1", access: "a1", expires: 1 }]
        }
      })
    )

    await setAccountCooldown(p, "acc-disabled", 999)

    const stored = await loadAuthStorage(p)
    const openai = stored.openai
    if (!openai || !("accounts" in openai)) throw new Error("missing accounts")

    const acc = openai.accounts.find((a) => a.identityKey === "acc-disabled")
    expect(acc?.cooldownUntil).toBeUndefined()
  })
})
