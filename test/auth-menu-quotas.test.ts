import { describe, expect, it, vi } from "vitest"

describe("auth menu quota refresh", () => {
  it("refreshes expired account by identity key after account reorder", async () => {
    vi.resetModules()

    const authState: Record<string, unknown> = {
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
            expires: Date.now() + 60_000,
            authTypes: ["native"]
          },
          {
            identityKey: "acc_2|two@example.com|plus",
            accountId: "acc_2",
            email: "two@example.com",
            plan: "plus",
            enabled: true,
            access: "at_2",
            refresh: "rt_2",
            expires: Date.now() - 1_000,
            authTypes: ["native"]
          }
        ]
      }
    }

    let saveCalls = 0
    const saveAuthStorage = vi.fn(
      async (
        _path: string | undefined,
        update: (
          auth: Record<string, unknown>
        ) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void
      ) => {
        saveCalls += 1
        if (saveCalls === 1) {
          const openai = authState.openai as { accounts?: Array<Record<string, unknown>> }
          openai.accounts?.reverse()
        }
        const next = await update(authState)
        if (next) {
          Object.assign(authState, next)
        }
        return authState
      }
    )

    vi.doMock("../lib/storage", () => ({
      loadAuthStorage: vi.fn(async () => authState),
      saveAuthStorage,
      ensureOpenAIOAuthDomain: vi.fn((auth: Record<string, unknown>, _mode: "native" | "codex") => {
        const openai = auth.openai as { type?: string; accounts?: unknown[] }
        if (!openai || openai.type !== "oauth") throw new Error("oauth missing")
        return { accounts: openai.accounts as Array<Record<string, unknown>> }
      }),
      listOpenAIOAuthDomains: vi.fn((auth: Record<string, unknown>) => {
        const openai = auth.openai as { type?: string; accounts?: unknown[] }
        if (!openai || openai.type !== "oauth" || !Array.isArray(openai.accounts)) return []
        return [{ mode: "native", domain: { accounts: openai.accounts } }]
      })
    }))

    const saveSnapshots = vi.fn(
      async (_path: string, update: (current: Record<string, unknown>) => Record<string, unknown>) => {
        return update({})
      }
    )
    vi.doMock("../lib/codex-status-storage", () => ({
      loadSnapshots: vi.fn(async () => ({})),
      saveSnapshots
    }))

    const refreshAccessToken = vi.fn(async (refresh: string) => ({
      refresh_token: `${refresh}_next`,
      access_token: `${refresh}_access_next`,
      expires_in: 3600,
      id_token:
        refresh === "rt_2"
          ? "eyJhbGciOiJub25lIn0.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjXzIiLCJjaGF0Z3B0X3BsYW5fdHlwZSI6InBsdXMifSwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9wcm9maWxlIjp7ImVtYWlsIjoidHdvQGV4YW1wbGUuY29tIn19.sig"
          : "eyJhbGciOiJub25lIn0.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjXzEiLCJjaGF0Z3B0X3BsYW5fdHlwZSI6InBsdXMifSwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9wcm9maWxlIjp7ImVtYWlsIjoib25lQGV4YW1wbGUuY29tIn19.sig"
    }))

    vi.doMock("../lib/codex-native/oauth-utils", async () => {
      const actual = await vi.importActual<typeof import("../lib/codex-native/oauth-utils")>(
        "../lib/codex-native/oauth-utils"
      )
      return {
        ...actual,
        refreshAccessToken
      }
    })

    const fetchQuotaSnapshotFromBackend = vi.fn(async (args: { accountId?: string }) => ({
      updatedAt: Date.now(),
      modelFamily: "gpt-5.3-codex",
      limits: [{ name: "requests", leftPct: args.accountId === "acc_2" ? 12 : 80 }]
    }))

    vi.doMock("../lib/codex-quota-fetch", () => ({
      fetchQuotaSnapshotFromBackend
    }))

    const { refreshQuotaSnapshotsForAuthMenu } = await import("../lib/codex-native/auth-menu-quotas")

    await refreshQuotaSnapshotsForAuthMenu({
      spoofMode: "native",
      cooldownByIdentity: new Map<string, number>()
    })

    expect(refreshAccessToken).toHaveBeenCalledWith("rt_2")
    const accountIds = new Set(
      fetchQuotaSnapshotFromBackend.mock.calls.map((call) => (call[0] as { accountId?: string })?.accountId)
    )
    expect(accountIds).toEqual(new Set(["acc_1", "acc_2"]))
    expect(saveSnapshots).toHaveBeenCalled()
  })
})
