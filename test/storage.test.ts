import { describe, expect, it } from "vitest"

import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { defaultAuthPath, defaultSessionAffinityPath, defaultSnapshotsPath } from "../lib/paths"
import { importLegacyInstallData, loadAuthStorage, saveAuthStorage, shouldOfferLegacyTransfer } from "../lib/storage"

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
}

describe("auth storage", () => {
  function fakeJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
    return `${header}.${body}.sig`
  }

  it("defaultAuthPath points at ~/.config/opencode/codex-accounts.json", () => {
    expect(defaultAuthPath()).toBe(path.join(os.homedir(), ".config", "opencode", "codex-accounts.json"))
  })

  it("defaultSessionAffinityPath points at ~/.config/opencode/cache/codex-session-affinity.json", () => {
    expect(defaultSessionAffinityPath()).toBe(
      path.join(os.homedir(), ".config", "opencode", "cache", "codex-session-affinity.json")
    )
  })

  it("defaultSnapshotsPath points at ~/.config/opencode/cache/codex-snapshots.json", () => {
    expect(defaultSnapshotsPath()).toBe(path.join(os.homedir(), ".config", "opencode", "cache", "codex-snapshots.json"))
  })

  it("loadAuthStorage creates parent dir and returns {} when missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-auth-"))
    const filePath = path.join(dir, "nested", "auth.json")

    const auth = await loadAuthStorage(filePath)

    expect(auth).toEqual({})
    const parent = await stat(path.dirname(filePath))
    expect(parent).toBeDefined()
    expect(parent.mode & 0o077).toBe(0)
  })

  it("migrates single-account openai oauth to multi-account schema", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-auth-"))
    const filePath = path.join(dir, "auth.json")
    const singleJson = await readFile(fixturePath("auth-single.json"), "utf8")
    await writeFile(filePath, singleJson, { mode: 0o600 })

    const auth = await loadAuthStorage(filePath)

    expect(auth.openai?.type).toBe("oauth")
    const openai = auth.openai
    if (!openai || openai.type !== "oauth") {
      throw new Error("Expected openai oauth auth")
    }
    expect("accounts" in openai).toBe(true)
    if (!("accounts" in openai)) {
      throw new Error("Expected migrated multi-account auth")
    }
    expect(Array.isArray(openai.accounts)).toBe(true)
    expect(openai.accounts).toHaveLength(1)
    const account = openai.accounts[0]
    expect(account.enabled).toBe(true)
    expect(account.identityKey).toBe("acc_123|user@example.com|plus")
    expect(openai.activeIdentityKey).toBe(account.identityKey)
  })

  it("imports legacy v4 openai-codex-accounts schema only through explicit transfer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "opencode-auth-home-"))
    const prevHome = process.env.HOME
    process.env.HOME = root

    try {
      const filePath = path.join(root, ".config", "opencode", "codex-accounts.json")
      const legacyPath = path.join(root, ".config", "opencode", "openai-codex-accounts.json")
      await mkdir(path.dirname(legacyPath), { recursive: true })
      await writeFile(
        legacyPath,
        `${JSON.stringify(
          {
            version: 4,
            accounts: [
              {
                refreshToken: "rt_1",
                accountId: "acc_1",
                email: "one@example.com",
                plan: "plus",
                enabled: true,
                lastUsed: 111
              },
              {
                refreshToken: "rt_2",
                accountId: "acc_2",
                email: "two@example.com",
                plan: "pro",
                enabled: false,
                coolingDownUntil: 9999
              }
            ],
            activeIndex: 1
          },
          null,
          2
        )}\n`,
        { mode: 0o600 }
      )

      const before = await loadAuthStorage(filePath)
      expect(before).toEqual({})

      const transfer = await importLegacyInstallData(filePath)
      expect(transfer.imported).toBe(2)

      const auth = await loadAuthStorage(filePath)
      const openai = auth.openai
      if (!openai || openai.type !== "oauth" || !("accounts" in openai)) {
        throw new Error("Expected migrated multi-account auth")
      }

      expect(openai.accounts).toHaveLength(2)
      expect(openai.accounts[0].identityKey).toBe("acc_1|one@example.com|plus")
      expect(openai.accounts[0].refresh).toBe("rt_1")
      expect(openai.accounts[0].expires).toBe(0)
      expect(openai.accounts[0].lastUsed).toBe(111)
      expect(openai.accounts[1].identityKey).toBe("acc_2|two@example.com|pro")
      expect(openai.accounts[1].enabled).toBe(false)
      expect(openai.accounts[1].cooldownUntil).toBe(9999)
      expect(openai.activeIdentityKey).toBe("acc_2|two@example.com|pro")
    } finally {
      if (prevHome === undefined) {
        delete process.env.HOME
      } else {
        process.env.HOME = prevHome
      }
    }
  })

  it("imports native OpenCode provider auth marker only through explicit transfer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "opencode-auth-home-"))
    const prevHome = process.env.HOME
    process.env.HOME = root

    try {
      const filePath = path.join(root, ".config", "opencode", "codex-accounts.json")
      const providerAuthPath = path.join(root, ".local", "share", "opencode", "auth.json")
      await mkdir(path.dirname(providerAuthPath), { recursive: true })
      const singleJson = await readFile(fixturePath("auth-single.json"), "utf8")
      await writeFile(providerAuthPath, singleJson, { mode: 0o600 })

      const before = await loadAuthStorage(filePath)
      expect(before).toEqual({})

      const transfer = await importLegacyInstallData(filePath)
      expect(transfer.imported).toBe(1)

      const auth = await loadAuthStorage(filePath)
      const openai = auth.openai
      if (!openai || openai.type !== "oauth" || !("accounts" in openai)) {
        throw new Error("Expected migrated multi-account auth")
      }
      expect(openai.accounts).toHaveLength(1)
    } finally {
      if (prevHome === undefined) {
        delete process.env.HOME
      } else {
        process.env.HOME = prevHome
      }
    }
  })

  it("hydrates account identity from JWT claims when oauth fields are missing", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-auth-"))
    const filePath = path.join(dir, "auth.json")
    const access = fakeJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acc_claims",
        chatgpt_plan_type: "team"
      },
      "https://api.openai.com/profile": {
        email: "ClaimsUser@example.com"
      }
    })
    await writeFile(
      filePath,
      `${JSON.stringify(
        {
          openai: {
            type: "oauth",
            refresh: "rt_claims",
            access,
            expires: Date.now() + 60_000
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
      throw new Error("Expected migrated multi-account auth")
    }

    expect(openai.accounts).toHaveLength(1)
    expect(openai.accounts[0].identityKey).toBe("acc_claims|claimsuser@example.com|team")
  })

  it("hydrates multi-account oauth records from access-token claims", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-auth-"))
    const filePath = path.join(dir, "codex-accounts.json")
    const access = fakeJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acc_multi",
        chatgpt_plan_type: "pro"
      },
      "https://api.openai.com/profile": {
        email: "MultiUser@example.com"
      }
    })
    await writeFile(
      filePath,
      `${JSON.stringify(
        {
          openai: {
            type: "oauth",
            accounts: [
              {
                access,
                refresh: "rt_multi",
                expires: Date.now() + 60_000
              }
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
      throw new Error("Expected migrated multi-account auth")
    }

    expect(openai.accounts).toHaveLength(1)
    expect(openai.accounts[0].identityKey).toBe("acc_multi|multiuser@example.com|pro")
  })

  it("keeps codex-accounts.json OpenAI-only when transfering from provider auth.json", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "opencode-auth-home-"))
    const prevHome = process.env.HOME
    process.env.HOME = root

    try {
      const filePath = path.join(root, ".config", "opencode", "codex-accounts.json")
      const providerAuthPath = path.join(root, ".local", "share", "opencode", "auth.json")
      const access = fakeJwt({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acc_provider",
          chatgpt_plan_type: "plus"
        },
        "https://api.openai.com/profile": {
          email: "provider@example.com"
        }
      })

      await mkdir(path.dirname(providerAuthPath), { recursive: true })
      await writeFile(
        providerAuthPath,
        `${JSON.stringify(
          {
            openai: {
              type: "oauth",
              refresh: "rt_provider",
              access,
              expires: Date.now() + 60_000
            },
            google: {
              type: "oauth",
              refresh: "g_rt",
              access: "g_at",
              expires: Date.now() + 60_000
            },
            opencode: {
              type: "api",
              key: "sk_local"
            }
          },
          null,
          2
        )}\n`,
        { mode: 0o600 }
      )

      await importLegacyInstallData(filePath)
      const auth = await loadAuthStorage(filePath)
      expect((auth as Record<string, unknown>).google).toBeUndefined()
      expect((auth as Record<string, unknown>).opencode).toBeUndefined()

      await saveAuthStorage(filePath, (current) => current)
      const persisted = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>
      expect(Object.keys(persisted)).toEqual(["openai"])
    } finally {
      if (prevHome === undefined) {
        delete process.env.HOME
      } else {
        process.env.HOME = prevHome
      }
    }
  })

  it("offers legacy transfer when codex-accounts.json is missing and legacy v4 file exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "opencode-auth-home-"))
    const prevHome = process.env.HOME
    process.env.HOME = root

    try {
      const filePath = path.join(root, ".config", "opencode", "codex-accounts.json")
      const legacyPath = path.join(root, ".config", "opencode", "openai-codex-accounts.json")
      await mkdir(path.dirname(legacyPath), { recursive: true })
      await writeFile(
        legacyPath,
        JSON.stringify({
          version: 4,
          activeIndex: 0,
          accounts: [{ refreshToken: "rt_legacy_1", accessToken: "at_legacy_1", expiresAt: Date.now() + 60_000 }]
        }),
        "utf8"
      )

      await expect(shouldOfferLegacyTransfer(filePath)).resolves.toBe(true)
    } finally {
      if (prevHome === undefined) {
        delete process.env.HOME
      } else {
        process.env.HOME = prevHome
      }
    }
  })

  it("offers legacy transfer when codex-accounts.json is missing and native auth.json exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "opencode-auth-home-"))
    const prevHome = process.env.HOME
    process.env.HOME = root

    try {
      const filePath = path.join(root, ".config", "opencode", "codex-accounts.json")
      const providerAuthPath = path.join(root, ".local", "share", "opencode", "auth.json")
      await mkdir(path.dirname(providerAuthPath), { recursive: true })
      await writeFile(
        providerAuthPath,
        JSON.stringify({
          openai: { type: "oauth", refresh: "rt_native", access: "at_native", expires: Date.now() + 60_000 }
        }),
        "utf8"
      )

      await expect(shouldOfferLegacyTransfer(filePath)).resolves.toBe(true)
    } finally {
      if (prevHome === undefined) {
        delete process.env.HOME
      } else {
        process.env.HOME = prevHome
      }
    }
  })

  it("does not offer legacy transfer when codex-accounts.json already exists", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-auth-"))
    const filePath = path.join(dir, "codex-accounts.json")
    const legacyPath = path.join(dir, "openai-codex-accounts.json")
    await writeFile(filePath, JSON.stringify({ openai: { type: "oauth", accounts: [] } }), "utf8")
    await writeFile(legacyPath, JSON.stringify({ version: 4, accounts: [] }), "utf8")

    await expect(shouldOfferLegacyTransfer(filePath)).resolves.toBe(false)
  })

  it("does not repopulate from legacy when codex-accounts exists with zero accounts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-auth-"))
    const filePath = path.join(dir, "codex-accounts.json")
    const legacyPath = path.join(dir, "openai-codex-accounts.json")

    await writeFile(
      filePath,
      `${JSON.stringify(
        {
          openai: {
            type: "oauth",
            accounts: [],
            activeIdentityKey: undefined
          }
        },
        null,
        2
      )}\n`,
      { mode: 0o600 }
    )
    await writeFile(
      legacyPath,
      `${JSON.stringify(
        {
          version: 4,
          accounts: [
            {
              refreshToken: "rt_should_not_restore",
              accountId: "acc_restore",
              email: "restore@example.com",
              plan: "plus",
              enabled: true
            }
          ]
        },
        null,
        2
      )}\n`,
      { mode: 0o600 }
    )

    const auth = await loadAuthStorage(filePath)
    const openai = auth.openai
    if (!openai || openai.type !== "oauth" || !("accounts" in openai)) {
      throw new Error("Expected multi-account auth")
    }

    expect(openai.accounts).toHaveLength(0)
  })

  it("saveAuthStorage writes atomically and enforces 0600 permissions", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-auth-"))
    const filePath = path.join(dir, "auth.json")
    await mkdir(path.dirname(filePath), { recursive: true })

    const multiJson = await readFile(fixturePath("auth-multi.json"), "utf8")
    const expected = JSON.parse(multiJson) as {
      openai: {
        type: "oauth"
        accounts: Array<{ identityKey: string }>
        activeIdentityKey?: string
        strategy?: string
      }
    }

    await saveAuthStorage(filePath, (auth) => {
      auth.openai = expected.openai as typeof auth.openai
      return auth
    })

    const onDisk = JSON.parse(await readFile(filePath, "utf8"))
    expect(onDisk.openai?.type).toBe("oauth")
    expect(onDisk.openai?.strategy).toBe(expected.openai.strategy)
    expect(onDisk.openai?.activeIdentityKey).toBe(expected.openai.activeIdentityKey)
    expect(onDisk.openai?.accounts).toHaveLength(expected.openai.accounts.length)
    expect(onDisk.openai?.native?.accounts).toHaveLength(expected.openai.accounts.length)
    expect(onDisk.openai?.native?.activeIdentityKey).toBe(expected.openai.activeIdentityKey)
    expect(onDisk.openai?.accounts?.[0]?.identityKey).toBe(expected.openai.accounts[0]?.identityKey)
    expect(onDisk.openai?.native?.accounts?.[0]?.identityKey).toBe(expected.openai.accounts[0]?.identityKey)

    const mode = (await stat(filePath)).mode & 0o777
    expect(mode).toBe(0o600)

    // After atomic write, no .tmp* leftover files should remain
    const siblings = await readdir(path.dirname(filePath))
    const tmpFiles = siblings.filter((f) => f.startsWith(path.basename(filePath) + ".tmp"))
    expect(tmpFiles).toHaveLength(0)
  })

  it("saveAuthStorage migrates before applying update", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-auth-"))
    const filePath = path.join(dir, "auth.json")
    const singleJson = await readFile(fixturePath("auth-single.json"), "utf8")
    await writeFile(filePath, singleJson, { mode: 0o600 })

    await saveAuthStorage(filePath, (auth) => {
      const openai = auth.openai
      if (!openai || openai.type !== "oauth" || !("accounts" in openai)) {
        throw new Error("Expected migrated multi-account auth")
      }
      expect(openai.accounts).toHaveLength(1)
      openai.strategy = "round_robin"
      return auth
    })

    const onDisk = JSON.parse(await readFile(filePath, "utf8"))
    expect(onDisk.openai.type).toBe("oauth")
    expect(onDisk.openai.strategy).toBe("round_robin")
    expect(onDisk.openai.native?.strategy).toBe("round_robin")
    expect(onDisk.openai.accounts).toHaveLength(1)
  })
})
