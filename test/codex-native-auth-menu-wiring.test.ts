import { afterEach, describe, expect, it, vi } from "vitest"

const TRANSFER_LABEL = "Transfer OpenAI accounts from native & old plugins?"

async function loadPluginWithMenu(input: {
  offerLegacyTransfer: boolean
  menuResult?: "add" | "continue" | "exit"
  authFile?: Record<string, unknown>
  refreshAccessTokenImpl?: (
    refreshToken: string,
    isSaveAuthStorageInProgress: () => boolean,
    storageState: Record<string, unknown>
  ) => Promise<{ refresh_token: string; access_token: string; expires_in?: number; id_token?: string }>
  runAuthMenuOnceImpl?: (args: {
    allowTransfer?: boolean
    accounts: Array<{ identityKey?: string; authTypes?: Array<"native" | "codex"> }>
    handlers: {
      onTransfer: () => Promise<void>
      onCheckQuotas: () => Promise<void>
      onRefreshAccount: (account: { identityKey?: string; authTypes?: Array<"native" | "codex"> }) => Promise<void>
      onDeleteAll: (scope: "native" | "codex" | "both") => Promise<void>
      onDeleteAccount: (account: { identityKey?: string }, scope: "native" | "codex" | "both") => Promise<void>
    }
  }) => Promise<"add" | "continue" | "exit">
  quotaSnapshot?: { updatedAt: number; modelFamily: string; limits: Array<{ name: string; leftPct: number }> }
  quotaSnapshotImpl?: (args: {
    accountId?: string
  }) =>
    | Promise<{ updatedAt: number; modelFamily: string; limits: Array<{ name: string; leftPct: number }> } | null>
    | { updatedAt: number; modelFamily: string; limits: Array<{ name: string; leftPct: number }> }
    | null
  initialSnapshots?: Record<string, unknown>
}) {
  vi.resetModules()

  const runAuthMenuOnce = vi.fn(input.runAuthMenuOnceImpl ?? (async () => input.menuResult ?? "exit"))
  let saveAuthStorageDepth = 0

  const storageState =
    input.authFile ??
    ({
      openai: {
        type: "oauth",
        accounts: [
          {
            identityKey: "acc_1|one@example.com|plus",
            accountId: "acc_1",
            email: "one@example.com",
            plan: "plus",
            authTypes: ["native", "codex"],
            enabled: true,
            refresh: "rt_1",
            access: "at_1",
            expires: Date.now() + 60_000
          }
        ],
        activeIdentityKey: "acc_1|one@example.com|plus"
      }
    } as Record<string, unknown>)

  vi.doMock("../lib/ui/auth-menu-runner", () => ({
    runAuthMenuOnce
  }))

  const saveAuthStorage = vi.fn(
    async (
      _filePath: string | undefined,
      update: (
        auth: Record<string, unknown>
      ) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void
    ) => {
      saveAuthStorageDepth += 1
      try {
        const next = await update(storageState)
        return next ?? storageState
      } finally {
        saveAuthStorageDepth -= 1
      }
    }
  )

  const getOpenAIOAuthDomain = vi.fn((auth: Record<string, unknown>, mode: "native" | "codex") => {
    const openai = auth.openai as Record<string, unknown> | undefined
    if (!openai || openai.type !== "oauth") return undefined
    const existing = openai[mode] as { accounts?: unknown[]; activeIdentityKey?: string; strategy?: string } | undefined
    if (existing && Array.isArray(existing.accounts)) {
      return existing
    }
    const sourceAccounts = Array.isArray(openai.accounts) ? (openai.accounts as Array<Record<string, unknown>>) : []
    const filtered = sourceAccounts.filter((account) => {
      const authTypes = Array.isArray(account.authTypes) ? account.authTypes : ["native"]
      return authTypes.includes(mode)
    })
    if (filtered.length === 0) return undefined
    const created = {
      strategy: openai.strategy as string | undefined,
      accounts: filtered,
      activeIdentityKey: openai.activeIdentityKey as string | undefined
    }
    openai[mode] = created
    return created
  })

  const ensureOpenAIOAuthDomain = vi.fn((auth: Record<string, unknown>, mode: "native" | "codex") => {
    const existing = getOpenAIOAuthDomain(auth, mode)
    if (existing) return existing
    const openai = auth.openai as Record<string, unknown> | undefined
    if (!openai || openai.type !== "oauth") {
      auth.openai = { type: "oauth", accounts: [], [mode]: { accounts: [] } }
      return (auth.openai as Record<string, unknown>)[mode] as { accounts: unknown[] }
    }
    const created = { accounts: [] as unknown[] }
    openai[mode] = created
    return created
  })

  const listOpenAIOAuthDomains = vi.fn((auth: Record<string, unknown>) => {
    const out: Array<{ mode: "native" | "codex"; domain: { accounts: unknown[] } }> = []
    for (const mode of ["native", "codex"] as const) {
      const domain = getOpenAIOAuthDomain(auth, mode)
      if (domain && Array.isArray(domain.accounts)) {
        out.push({ mode, domain: domain as { accounts: unknown[] } })
      }
    }
    return out
  })

  vi.doMock("../lib/storage", () => ({
    loadAuthStorage: vi.fn(async () => storageState),
    saveAuthStorage,
    importLegacyInstallData: vi.fn(async () => ({ imported: 0, sourcesUsed: 0 })),
    getOpenAIOAuthDomain,
    ensureOpenAIOAuthDomain,
    listOpenAIOAuthDomains,
    setAccountCooldown: vi.fn(async () => {}),
    shouldOfferLegacyTransfer: vi.fn(async () => input.offerLegacyTransfer)
  }))

  vi.doMock("../lib/model-catalog", () => ({
    getCodexModelCatalog: vi.fn(async () => undefined),
    applyCodexCatalogToProviderModels: vi.fn(
      (args: { providerModels: Record<string, Record<string, unknown>> }) => args.providerModels
    )
  }))

  const snapshotStore: Record<string, unknown> = {
    ...(input.initialSnapshots ?? {})
  }
  const saveSnapshots = vi.fn(
    async (
      _path: string,
      update: (current: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>
    ) => {
      const next = await update(snapshotStore)
      Object.assign(snapshotStore, next)
      return snapshotStore
    }
  )
  const toolOutputForStatus = vi.fn(async () => "Quota snapshot\n")
  const fetchQuotaSnapshotFromBackend = vi.fn(async (args: { accountId?: string }) => {
    if (input.quotaSnapshotImpl) {
      return await input.quotaSnapshotImpl(args)
    }
    return input.quotaSnapshot ?? null
  })

  vi.doMock("../lib/codex-status-storage", () => ({
    loadSnapshots: vi.fn(async () => snapshotStore),
    saveSnapshots
  }))
  vi.doMock("../lib/codex-status-tool", () => ({
    toolOutputForStatus
  }))
  vi.doMock("../lib/codex-quota-fetch", () => ({
    fetchQuotaSnapshotFromBackend
  }))

  const refreshAccessToken = vi.fn(async (refreshToken: string) => {
    if (input.refreshAccessTokenImpl) {
      return await input.refreshAccessTokenImpl(refreshToken, () => saveAuthStorageDepth > 0, storageState)
    }
    return {
      refresh_token: refreshToken,
      access_token: `access_${refreshToken}`,
      expires_in: 3600,
      id_token: buildJwt({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acc_1",
          chatgpt_plan_type: "plus"
        },
        "https://api.openai.com/profile": {
          email: "one@example.com"
        }
      })
    }
  })

  vi.doMock("../lib/codex-native/oauth-utils", async () => {
    const actual = await vi.importActual<typeof import("../lib/codex-native/oauth-utils")>(
      "../lib/codex-native/oauth-utils"
    )
    return {
      ...actual,
      refreshAccessToken
    }
  })

  const { CodexAuthPlugin } = await import("../lib/codex-native")
  const hooks = await CodexAuthPlugin({} as never)
  return {
    hooks,
    runAuthMenuOnce,
    storageState,
    saveAuthStorage,
    saveSnapshots,
    toolOutputForStatus,
    fetchQuotaSnapshotFromBackend,
    refreshAccessToken,
    snapshotStore
  }
}

function buildJwt(payload: Record<string, unknown>): string {
  return [
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "sig"
  ].join(".")
}

describe("codex-native auth menu wiring", () => {
  afterEach(async () => {
    const { __testOnly } = await import("../lib/codex-native")
    __testOnly.stopOAuthServer()
    vi.unstubAllGlobals()
  })

  it("keeps auth methods list native (no standalone transfer method)", async () => {
    const { hooks } = await loadPluginWithMenu({
      offerLegacyTransfer: true,
      menuResult: "exit"
    })
    const labels = hooks.auth?.methods.map((method) => method.label) ?? []
    expect(labels).not.toContain(TRANSFER_LABEL)
    expect(labels).toContain("ChatGPT Pro/Plus (browser)")
  })

  it("shows interactive menu in CLI login flow and can cancel login", async () => {
    const { hooks, runAuthMenuOnce } = await loadPluginWithMenu({
      offerLegacyTransfer: true,
      menuResult: "exit"
    })
    const browserMethod = hooks.auth?.methods.find((method) => method.label === "ChatGPT Pro/Plus (browser)")
    expect(browserMethod).toBeDefined()
    if (!browserMethod || browserMethod.type !== "oauth") throw new Error("Missing browser oauth method")

    const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean }
    const stdout = process.stdout as NodeJS.WriteStream & { isTTY?: boolean }
    const prevIn = stdin.isTTY
    const prevOut = stdout.isTTY
    stdin.isTTY = true
    stdout.isTTY = true

    try {
      const flow = await browserMethod.authorize({})
      expect(runAuthMenuOnce).toHaveBeenCalledTimes(1)
      expect(flow.instructions).toBe("Login cancelled.")
      expect(flow.method).toBe("auto")
      expect(flow.url).toBe("")
      const result = await flow.callback("")
      expect(result.type).toBe("failed")
    } finally {
      stdin.isTTY = prevIn
      stdout.isTTY = prevOut
    }
  })

  it("passes transfer availability flag into auth menu runner", async () => {
    const { hooks, runAuthMenuOnce } = await loadPluginWithMenu({
      offerLegacyTransfer: true,
      menuResult: "exit"
    })
    const browserMethod = hooks.auth?.methods.find((method) => method.label === "ChatGPT Pro/Plus (browser)")
    if (!browserMethod || browserMethod.type !== "oauth") throw new Error("Missing browser oauth method")

    const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean }
    const stdout = process.stdout as NodeJS.WriteStream & { isTTY?: boolean }
    const prevIn = stdin.isTTY
    const prevOut = stdout.isTTY
    stdin.isTTY = true
    stdout.isTTY = true

    try {
      await browserMethod.authorize({})
      expect(runAuthMenuOnce).toHaveBeenCalledTimes(1)
      const call = runAuthMenuOnce.mock.calls[0]?.[0] as { allowTransfer?: boolean } | undefined
      expect(call?.allowTransfer).toBe(true)
    } finally {
      stdin.isTTY = prevIn
      stdout.isTTY = prevOut
    }
  })

  it("hydrates imported account identity during transfer action", async () => {
    const access = buildJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acc_hydrated",
        chatgpt_plan_type: "pro"
      },
      "https://api.openai.com/profile": {
        email: "HydratedUser@example.com"
      }
    })

    const { hooks, storageState, saveAuthStorage } = await loadPluginWithMenu({
      offerLegacyTransfer: true,
      authFile: {
        openai: {
          type: "oauth",
          accounts: [
            {
              access,
              refresh: "rt_hydrate",
              expires: Date.now() + 60_000,
              enabled: true
            }
          ]
        }
      },
      runAuthMenuOnceImpl: async (args) => {
        await args.handlers.onTransfer()
        return "exit"
      }
    })

    const browserMethod = hooks.auth?.methods.find((method) => method.label === "ChatGPT Pro/Plus (browser)")
    if (!browserMethod || browserMethod.type !== "oauth") throw new Error("Missing browser oauth method")

    const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean }
    const stdout = process.stdout as NodeJS.WriteStream & { isTTY?: boolean }
    const prevIn = stdin.isTTY
    const prevOut = stdout.isTTY
    stdin.isTTY = true
    stdout.isTTY = true

    try {
      await browserMethod.authorize({})
      expect(saveAuthStorage).toHaveBeenCalled()
      const openai = (storageState as { openai?: { accounts?: Array<{ identityKey?: string }> } }).openai
      expect(openai?.accounts?.[0]?.identityKey).toBe("acc_hydrated|hydrateduser@example.com|pro")
    } finally {
      stdin.isTTY = prevIn
      stdout.isTTY = prevOut
    }
  })

  it("persists transfer refresh by identity key when account order changes", async () => {
    const transferRefresh = vi.fn(async (refreshToken: string) => {
      if (refreshToken === "rt_two") {
        return {
          refresh_token: "rt_two_next",
          access_token: "at_two_next",
          expires_in: 3600,
          id_token: buildJwt({
            "https://api.openai.com/auth": {
              chatgpt_account_id: "acc_two",
              chatgpt_plan_type: "plus"
            },
            "https://api.openai.com/profile": {
              email: "two@example.com"
            }
          })
        }
      }

      return {
        refresh_token: refreshToken,
        access_token: `access_${refreshToken}`,
        expires_in: 3600,
        id_token: buildJwt({
          "https://api.openai.com/auth": {
            chatgpt_account_id: "acc_one",
            chatgpt_plan_type: "plus"
          },
          "https://api.openai.com/profile": {
            email: "one@example.com"
          }
        })
      }
    })

    const { hooks, storageState } = await loadPluginWithMenu({
      offerLegacyTransfer: true,
      authFile: {
        openai: {
          type: "oauth",
          accounts: [
            {
              identityKey: "acc_one|one@example.com|plus",
              accountId: "acc_one",
              email: "one@example.com",
              plan: "plus",
              enabled: true,
              refresh: "rt_one",
              access: "at_one",
              expires: Date.now() + 60_000
            },
            {
              enabled: true,
              refresh: "rt_two",
              access: "at_two",
              expires: Date.now() - 1_000
            }
          ],
          activeIdentityKey: "acc_two|two@example.com|plus"
        }
      },
      runAuthMenuOnceImpl: async (args) => {
        await args.handlers.onTransfer()
        return "exit"
      },
      refreshAccessTokenImpl: async (refreshToken, _isLocked, _authState) => {
        const openai = _authState.openai as { accounts?: Array<Record<string, unknown>> } | undefined
        if (openai?.accounts) {
          openai.accounts.reverse()
        }
        return await transferRefresh(refreshToken)
      }
    })

    const browserMethod = hooks.auth?.methods.find((method) => method.label === "ChatGPT Pro/Plus (browser)")
    if (!browserMethod || browserMethod.type !== "oauth") throw new Error("Missing browser oauth method")

    const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean }
    const stdout = process.stdout as NodeJS.WriteStream & { isTTY?: boolean }
    const prevIn = stdin.isTTY
    const prevOut = stdout.isTTY
    stdin.isTTY = true
    stdout.isTTY = true

    try {
      await browserMethod.authorize({})
      const openai = (storageState as { openai?: { accounts?: Array<Record<string, unknown>> } }).openai
      const accounts = openai?.accounts ?? []
      const first = accounts.find((account) => account.refresh === "rt_one")
      const second = accounts.find((account) => account.refresh === "rt_two_next")

      expect(first?.access).toBe("at_one")
      expect(second?.access).toBe("at_two_next")
      expect(transferRefresh).toHaveBeenCalledWith("rt_two")
    } finally {
      stdin.isTTY = prevIn
      stdout.isTTY = prevOut
    }
  })

  it("refreshes quota snapshots during check quotas action", async () => {
    const { hooks, fetchQuotaSnapshotFromBackend, saveSnapshots, toolOutputForStatus, snapshotStore } =
      await loadPluginWithMenu({
        offerLegacyTransfer: false,
        authFile: {
          openai: {
            type: "oauth",
            accounts: [
              {
                identityKey: "acc_1|one@example.com|plus",
                accountId: "acc_1",
                email: "one@example.com",
                plan: "plus",
                enabled: true,
                access: "at_1",
                refresh: "rt_1",
                expires: Date.now() + 60_000
              }
            ],
            activeIdentityKey: "acc_1|one@example.com|plus"
          }
        },
        runAuthMenuOnceImpl: async (args) => {
          await args.handlers.onCheckQuotas()
          return "exit"
        },
        quotaSnapshot: {
          updatedAt: 123,
          modelFamily: "gpt-5.3-codex",
          limits: [{ name: "requests", leftPct: 88 }]
        }
      })

    const browserMethod = hooks.auth?.methods.find((method) => method.label === "ChatGPT Pro/Plus (browser)")
    if (!browserMethod || browserMethod.type !== "oauth") throw new Error("Missing browser oauth method")

    const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean }
    const stdout = process.stdout as NodeJS.WriteStream & { isTTY?: boolean }
    const prevIn = stdin.isTTY
    const prevOut = stdout.isTTY
    stdin.isTTY = true
    stdout.isTTY = true

    try {
      await browserMethod.authorize({})
      expect(fetchQuotaSnapshotFromBackend).toHaveBeenCalledTimes(1)
      expect(saveSnapshots).toHaveBeenCalledTimes(1)
      expect(toolOutputForStatus).toHaveBeenCalledTimes(1)
      expect(toolOutputForStatus).toHaveBeenCalledWith(undefined, undefined, expect.objectContaining({ style: "menu" }))
      expect(snapshotStore["acc_1|one@example.com|plus"]).toEqual({
        updatedAt: 123,
        modelFamily: "gpt-5.3-codex",
        limits: [{ name: "requests", leftPct: 88 }]
      })
    } finally {
      stdin.isTTY = prevIn
      stdout.isTTY = prevOut
    }
  })

  it("reuses fresh quota snapshots from storage without hitting network", async () => {
    vi.useFakeTimers()
    const now = new Date("2026-02-12T01:00:00.000Z")
    vi.setSystemTime(now)

    const identityKey = "acc_1|one@example.com|plus"
    const { hooks, fetchQuotaSnapshotFromBackend, saveSnapshots, toolOutputForStatus } = await loadPluginWithMenu({
      offerLegacyTransfer: false,
      authFile: {
        openai: {
          type: "oauth",
          accounts: [
            {
              identityKey,
              accountId: "acc_1",
              email: "one@example.com",
              plan: "plus",
              enabled: true,
              access: "at_1",
              refresh: "rt_1",
              expires: Date.now() + 60_000
            }
          ],
          activeIdentityKey: identityKey
        }
      },
      runAuthMenuOnceImpl: async (args) => {
        await args.handlers.onCheckQuotas()
        return "exit"
      },
      initialSnapshots: {
        [identityKey]: {
          updatedAt: Date.now() - 10_000,
          modelFamily: "gpt-5.3-codex",
          limits: [{ name: "requests", leftPct: 42 }]
        }
      }
    })

    const browserMethod = hooks.auth?.methods.find((method) => method.label === "ChatGPT Pro/Plus (browser)")
    if (!browserMethod || browserMethod.type !== "oauth") throw new Error("Missing browser oauth method")

    const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean }
    const stdout = process.stdout as NodeJS.WriteStream & { isTTY?: boolean }
    const prevIn = stdin.isTTY
    const prevOut = stdout.isTTY
    stdin.isTTY = true
    stdout.isTTY = true

    try {
      await browserMethod.authorize({})
      expect(fetchQuotaSnapshotFromBackend).not.toHaveBeenCalled()
      expect(saveSnapshots).not.toHaveBeenCalled()
      expect(toolOutputForStatus).toHaveBeenCalledTimes(1)
    } finally {
      stdin.isTTY = prevIn
      stdout.isTTY = prevOut
      vi.useRealTimers()
    }
  })

  it("keeps same-email plus/team quota snapshots isolated during check quotas action", async () => {
    const { hooks, fetchQuotaSnapshotFromBackend, snapshotStore } = await loadPluginWithMenu({
      offerLegacyTransfer: false,
      authFile: {
        openai: {
          type: "oauth",
          accounts: [
            {
              identityKey: "acc_live_plus|same@example.com|plus",
              accountId: "acc_live_plus",
              email: "same@example.com",
              plan: "plus",
              authTypes: ["native", "codex"],
              enabled: true,
              access: "at_plus",
              refresh: "rt_plus",
              expires: Date.now() + 60_000
            },
            {
              identityKey: "acc_live_team|same@example.com|team",
              accountId: "acc_live_team",
              email: "same@example.com",
              plan: "team",
              authTypes: ["native", "codex"],
              enabled: true,
              access: "at_team",
              refresh: "rt_team",
              expires: Date.now() + 60_000
            }
          ],
          activeIdentityKey: "acc_live_team|same@example.com|team"
        }
      },
      runAuthMenuOnceImpl: async (args) => {
        await args.handlers.onCheckQuotas()
        return "exit"
      },
      quotaSnapshotImpl: async ({ accountId }) => {
        if (accountId === "acc_live_plus") {
          return {
            updatedAt: 300,
            modelFamily: "gpt-5.3-codex",
            limits: [{ name: "requests", leftPct: 78 }]
          }
        }
        if (accountId === "acc_live_team") {
          return {
            updatedAt: 301,
            modelFamily: "gpt-5.3-codex",
            limits: [{ name: "requests", leftPct: 12 }]
          }
        }
        return null
      }
    })

    const browserMethod = hooks.auth?.methods.find((method) => method.label === "ChatGPT Pro/Plus (browser)")
    if (!browserMethod || browserMethod.type !== "oauth") throw new Error("Missing browser oauth method")

    const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean }
    const stdout = process.stdout as NodeJS.WriteStream & { isTTY?: boolean }
    const prevIn = stdin.isTTY
    const prevOut = stdout.isTTY
    stdin.isTTY = true
    stdout.isTTY = true

    try {
      await browserMethod.authorize({})

      const requestedAccountIds = new Set(
        fetchQuotaSnapshotFromBackend.mock.calls.map((call) => (call[0] as { accountId?: string })?.accountId)
      )
      expect(requestedAccountIds).toEqual(new Set(["acc_live_plus", "acc_live_team"]))
      expect(snapshotStore["acc_live_plus|same@example.com|plus"]).toEqual({
        updatedAt: 300,
        modelFamily: "gpt-5.3-codex",
        limits: [{ name: "requests", leftPct: 78 }]
      })
      expect(snapshotStore["acc_live_team|same@example.com|team"]).toEqual({
        updatedAt: 301,
        modelFamily: "gpt-5.3-codex",
        limits: [{ name: "requests", leftPct: 12 }]
      })
    } finally {
      stdin.isTTY = prevIn
      stdout.isTTY = prevOut
    }
  })

  it("supports scoped account deletion by auth type", async () => {
    const { hooks, storageState } = await loadPluginWithMenu({
      offerLegacyTransfer: false,
      authFile: {
        openai: {
          type: "oauth",
          accounts: [
            {
              identityKey: "acc_1|one@example.com|plus",
              accountId: "acc_1",
              email: "one@example.com",
              plan: "plus",
              authTypes: ["native", "codex"],
              enabled: true,
              refresh: "rt_1",
              access: "at_1",
              expires: Date.now() + 60_000
            }
          ],
          activeIdentityKey: "acc_1|one@example.com|plus"
        }
      },
      runAuthMenuOnceImpl: async (args) => {
        const account = args.accounts[0]
        if (!account) throw new Error("Missing menu account")
        await args.handlers.onDeleteAccount(account, "codex")
        return "exit"
      }
    })

    const browserMethod = hooks.auth?.methods.find((method) => method.label === "ChatGPT Pro/Plus (browser)")
    if (!browserMethod || browserMethod.type !== "oauth") throw new Error("Missing browser oauth method")

    const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean }
    const stdout = process.stdout as NodeJS.WriteStream & { isTTY?: boolean }
    const prevIn = stdin.isTTY
    const prevOut = stdout.isTTY
    stdin.isTTY = true
    stdout.isTTY = true

    try {
      await browserMethod.authorize({})
      const openai = (
        storageState as {
          openai?: {
            native?: { accounts?: Array<{ identityKey?: string }> }
            codex?: { accounts?: Array<{ identityKey?: string }> }
          }
        }
      ).openai
      expect(openai?.native?.accounts?.map((account) => account.identityKey)).toEqual(["acc_1|one@example.com|plus"])
      expect(openai?.codex?.accounts ?? []).toHaveLength(0)
    } finally {
      stdin.isTTY = prevIn
      stdout.isTTY = prevOut
    }
  })

  it("refreshes account tokens outside saveAuthStorage lock", async () => {
    const observedLockStates: boolean[] = []
    const { hooks, refreshAccessToken } = await loadPluginWithMenu({
      offerLegacyTransfer: false,
      authFile: {
        openai: {
          type: "oauth",
          accounts: [
            {
              identityKey: "acc_1|one@example.com|plus",
              accountId: "acc_1",
              email: "one@example.com",
              plan: "plus",
              authTypes: ["native", "codex"],
              enabled: true,
              refresh: "rt_1",
              access: "at_1",
              expires: Date.now() - 1_000
            }
          ],
          activeIdentityKey: "acc_1|one@example.com|plus"
        }
      },
      runAuthMenuOnceImpl: async (args) => {
        const account = args.accounts[0]
        if (!account) throw new Error("Missing menu account")
        await args.handlers.onRefreshAccount(account)
        return "exit"
      },
      refreshAccessTokenImpl: async (refreshToken, isSaveAuthStorageInProgress) => {
        observedLockStates.push(isSaveAuthStorageInProgress())
        return {
          refresh_token: refreshToken,
          access_token: "at_fresh",
          expires_in: 3600,
          id_token: buildJwt({
            "https://api.openai.com/auth": {
              chatgpt_account_id: "acc_1",
              chatgpt_plan_type: "plus"
            },
            "https://api.openai.com/profile": {
              email: "one@example.com"
            }
          })
        }
      }
    })

    const browserMethod = hooks.auth?.methods.find((method) => method.label === "ChatGPT Pro/Plus (browser)")
    if (!browserMethod || browserMethod.type !== "oauth") throw new Error("Missing browser oauth method")

    const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean }
    const stdout = process.stdout as NodeJS.WriteStream & { isTTY?: boolean }
    const prevIn = stdin.isTTY
    const prevOut = stdout.isTTY
    stdin.isTTY = true
    stdout.isTTY = true

    try {
      await browserMethod.authorize({})
      expect(refreshAccessToken).toHaveBeenCalled()
      expect(observedLockStates).toEqual([false])
    } finally {
      stdin.isTTY = prevIn
      stdout.isTTY = prevOut
    }
  })

  it("refreshes quota snapshots without holding saveAuthStorage lock during token refresh", async () => {
    const observedLockStates: boolean[] = []
    const { hooks, refreshAccessToken } = await loadPluginWithMenu({
      offerLegacyTransfer: false,
      authFile: {
        openai: {
          type: "oauth",
          accounts: [
            {
              identityKey: "acc_1|one@example.com|plus",
              accountId: "acc_1",
              email: "one@example.com",
              plan: "plus",
              enabled: true,
              access: "at_1",
              refresh: "rt_1",
              expires: Date.now() - 1_000
            }
          ],
          activeIdentityKey: "acc_1|one@example.com|plus"
        }
      },
      runAuthMenuOnceImpl: async (args) => {
        await args.handlers.onCheckQuotas()
        return "exit"
      },
      refreshAccessTokenImpl: async (refreshToken, isSaveAuthStorageInProgress) => {
        observedLockStates.push(isSaveAuthStorageInProgress())
        return {
          refresh_token: refreshToken,
          access_token: "at_fresh",
          expires_in: 3600,
          id_token: buildJwt({
            "https://api.openai.com/auth": {
              chatgpt_account_id: "acc_1",
              chatgpt_plan_type: "plus"
            },
            "https://api.openai.com/profile": {
              email: "one@example.com"
            }
          })
        }
      },
      quotaSnapshot: {
        updatedAt: 400,
        modelFamily: "gpt-5.3-codex",
        limits: [{ name: "requests", leftPct: 88 }]
      }
    })

    const browserMethod = hooks.auth?.methods.find((method) => method.label === "ChatGPT Pro/Plus (browser)")
    if (!browserMethod || browserMethod.type !== "oauth") throw new Error("Missing browser oauth method")

    const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean }
    const stdout = process.stdout as NodeJS.WriteStream & { isTTY?: boolean }
    const prevIn = stdin.isTTY
    const prevOut = stdout.isTTY
    stdin.isTTY = true
    stdout.isTTY = true

    try {
      await browserMethod.authorize({})
      expect(refreshAccessToken).toHaveBeenCalled()
      expect(observedLockStates).toEqual([false])
    } finally {
      stdin.isTTY = prevIn
      stdout.isTTY = prevOut
    }
  })

  it("supports scoped delete-all by auth type", async () => {
    const { hooks, storageState } = await loadPluginWithMenu({
      offerLegacyTransfer: false,
      authFile: {
        openai: {
          type: "oauth",
          accounts: [
            {
              identityKey: "acc_native|one@example.com|plus",
              accountId: "acc_native",
              email: "one@example.com",
              plan: "plus",
              authTypes: ["native"],
              enabled: true,
              refresh: "rt_native",
              access: "at_native",
              expires: Date.now() + 60_000
            },
            {
              identityKey: "acc_codex|two@example.com|pro",
              accountId: "acc_codex",
              email: "two@example.com",
              plan: "pro",
              authTypes: ["codex"],
              enabled: true,
              refresh: "rt_codex",
              access: "at_codex",
              expires: Date.now() + 60_000
            }
          ],
          activeIdentityKey: "acc_codex|two@example.com|pro"
        }
      },
      runAuthMenuOnceImpl: async (args) => {
        await args.handlers.onDeleteAll("codex")
        return "exit"
      }
    })

    const browserMethod = hooks.auth?.methods.find((method) => method.label === "ChatGPT Pro/Plus (browser)")
    if (!browserMethod || browserMethod.type !== "oauth") throw new Error("Missing browser oauth method")

    const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean }
    const stdout = process.stdout as NodeJS.WriteStream & { isTTY?: boolean }
    const prevIn = stdin.isTTY
    const prevOut = stdout.isTTY
    stdin.isTTY = true
    stdout.isTTY = true

    try {
      await browserMethod.authorize({})
      const openai = (
        storageState as {
          openai?: {
            native?: { accounts?: Array<{ identityKey?: string }>; activeIdentityKey?: string }
            codex?: { accounts?: Array<{ identityKey?: string }>; activeIdentityKey?: string }
          }
        }
      ).openai
      expect(openai?.native?.accounts?.map((account) => account.identityKey)).toEqual([
        "acc_native|one@example.com|plus"
      ])
      expect(openai?.codex?.accounts ?? []).toHaveLength(0)
    } finally {
      stdin.isTTY = prevIn
      stdout.isTTY = prevOut
    }
  })
})
