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
          {
            identityKey: "a",
            enabled: true,
            refresh: "ra",
            access: "oldA",
            expires: 50_000,
            accountId: "1",
            email: "a@example.com",
            plan: "plus"
          },
          {
            identityKey: "b",
            enabled: false,
            refresh: "rb",
            access: "oldB",
            expires: 50_000,
            accountId: "2",
            email: "b@example.com",
            plan: "plus"
          }
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

    const accountA = openai.accounts.find((a) => a.identityKey === "a")
    const accountB = openai.accounts.find((a) => a.identityKey === "b")

    expect(accountA?.access).toBe("newA")
    expect(accountB?.access).toBe("oldB")
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith("ra")
  })

  it("refreshes accounts with expires set to zero", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-refresh-"))
    const p = path.join(dir, "auth.json")

    await saveAuthStorage(p, (cur) => ({
      ...cur,
      openai: {
        type: "oauth",
        strategy: "round_robin",
        accounts: [
          {
            identityKey: "z",
            enabled: true,
            refresh: "rz",
            access: "oldZ",
            expires: 0,
            accountId: "3",
            email: "z@example.com",
            plan: "plus"
          }
        ]
      }
    }))

    const refresh = vi.fn(async (refreshToken: string) => ({
      access: "newZ",
      refresh: refreshToken,
      expires: 999_999
    }))

    await runOneProactiveRefreshTick({
      authPath: p,
      now: () => 1_000,
      bufferMs: 10_000,
      refresh
    })

    const stored = await loadAuthStorage(p)
    const openai = stored.openai
    if (!openai || !("accounts" in openai)) throw new Error("missing")

    const accountZ = openai.accounts.find((a) => a.identityKey === "z")
    expect(accountZ?.access).toBe("newZ")
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalledWith("rz")
  })

  it("disables account when proactive refresh returns invalid_grant", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-refresh-"))
    const p = path.join(dir, "auth.json")

    await saveAuthStorage(p, (cur) => ({
      ...cur,
      openai: {
        type: "oauth",
        strategy: "round_robin",
        accounts: [
          {
            identityKey: "bad",
            enabled: true,
            refresh: "rbad",
            access: "oldBad",
            expires: 0,
            accountId: "4",
            email: "bad@example.com",
            plan: "plus"
          }
        ]
      }
    }))

    const refresh = vi.fn(async () => {
      const error = new Error("Token refresh failed (invalid_grant)")
      ;(error as Error & { oauthCode?: string }).oauthCode = "invalid_grant"
      throw error
    })

    await runOneProactiveRefreshTick({
      authPath: p,
      now: () => 1_000,
      bufferMs: 10_000,
      refresh
    })

    const stored = await loadAuthStorage(p)
    const openai = stored.openai
    if (!openai || !("accounts" in openai)) throw new Error("missing")

    const account = openai.accounts.find((a) => a.identityKey === "bad")
    expect(account?.enabled).toBe(false)
    expect(account?.refreshLeaseUntil).toBeUndefined()
    expect(account?.cooldownUntil).toBeUndefined()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("clears lease and applies cooldown for transient proactive refresh failures", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-refresh-"))
    const p = path.join(dir, "auth.json")

    await saveAuthStorage(p, (cur) => ({
      ...cur,
      openai: {
        type: "oauth",
        strategy: "round_robin",
        accounts: [
          {
            identityKey: "temp",
            enabled: true,
            refresh: "rtemp",
            access: "oldTemp",
            expires: 0,
            accountId: "5",
            email: "temp@example.com",
            plan: "plus"
          }
        ]
      }
    }))

    const refresh = vi.fn(async () => {
      throw new Error("network timeout")
    })

    await runOneProactiveRefreshTick({
      authPath: p,
      now: () => 2_000,
      bufferMs: 10_000,
      refresh
    })

    const stored = await loadAuthStorage(p)
    const openai = stored.openai
    if (!openai || !("accounts" in openai)) throw new Error("missing")

    const account = openai.accounts.find((a) => a.identityKey === "temp")
    expect(account?.enabled).toBe(true)
    expect(account?.refreshLeaseUntil).toBeUndefined()
    expect(account?.cooldownUntil).toBe(32_000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
