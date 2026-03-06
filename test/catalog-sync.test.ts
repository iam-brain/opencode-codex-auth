import { afterEach, describe, expect, it, vi } from "vitest"

const catalogSyncMocks = vi.hoisted(() => ({
  getCodexModelCatalog: vi.fn(),
  loadAuthStorage: vi.fn(async () => ({})),
  getOpenAIOAuthDomain: vi.fn(),
  selectAccount: vi.fn()
}))

vi.doMock("../lib/storage.js", () => ({
  loadAuthStorage: catalogSyncMocks.loadAuthStorage,
  getOpenAIOAuthDomain: catalogSyncMocks.getOpenAIOAuthDomain
}))

vi.doMock("../lib/rotation.js", () => ({
  selectAccount: catalogSyncMocks.selectAccount
}))

vi.doMock("../lib/model-catalog.js", () => ({
  getCodexModelCatalog: catalogSyncMocks.getCodexModelCatalog
}))

describe("catalog sync", () => {
  afterEach(() => {
    vi.resetModules()
    catalogSyncMocks.getCodexModelCatalog.mockReset()
    catalogSyncMocks.loadAuthStorage.mockReset()
    catalogSyncMocks.getOpenAIOAuthDomain.mockReset()
    catalogSyncMocks.selectAccount.mockReset()
  })

  it("bootstraps with selected auth candidate and applies refreshed catalogs", async () => {
    catalogSyncMocks.getOpenAIOAuthDomain.mockReturnValue({
      strategy: "sticky",
      activeIdentityKey: "acc_seed",
      accounts: [{ identityKey: "acc_seed" }]
    })
    catalogSyncMocks.selectAccount.mockReturnValue({
      access: "seed-token",
      accountId: "acc_seed",
      expires: Date.now() + 10_000
    })
    catalogSyncMocks.getCodexModelCatalog
      .mockResolvedValueOnce([{ slug: "gpt-5.3-codex" }])
      .mockResolvedValueOnce([{ slug: "gpt-5.4-codex" }])

    const { initializeCatalogSync } = await import("../lib/codex-native/catalog-sync.js")

    const setCatalogModels = vi.fn()
    const activateCatalogScope = vi.fn()
    const syncCatalogFromAuth = await initializeCatalogSync({
      authMode: "native",
      pidOffsetEnabled: false,
      rotationStrategy: "sticky",
      resolveCatalogHeaders: () => ({
        originator: "opencode",
        userAgent: "opencode/test",
        clientVersion: "0.0.0",
        versionHeader: "0.0.0"
      }),
      setCatalogModels,
      activateCatalogScope
    })

    expect(catalogSyncMocks.loadAuthStorage).toHaveBeenCalledTimes(1)
    expect(catalogSyncMocks.selectAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        strategy: "sticky",
        stickyPidOffset: false
      })
    )
    expect(catalogSyncMocks.getCodexModelCatalog).toHaveBeenCalledTimes(1)
    expect(catalogSyncMocks.getCodexModelCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "seed-token",
        accountId: "acc_seed",
        originator: "opencode"
      })
    )
    expect(setCatalogModels).toHaveBeenNthCalledWith(1, "account:acc_seed", [{ slug: "gpt-5.3-codex" }])
    expect(activateCatalogScope).toHaveBeenCalledWith("account:acc_seed")

    await expect(syncCatalogFromAuth({})).resolves.toBeUndefined()
    expect(catalogSyncMocks.getCodexModelCatalog).toHaveBeenCalledTimes(1)

    await expect(syncCatalogFromAuth({ accessToken: "next-token", accountId: "acc_next" })).resolves.toEqual([
      { slug: "gpt-5.4-codex" }
    ])
    expect(catalogSyncMocks.getCodexModelCatalog).toHaveBeenCalledTimes(2)
    expect(catalogSyncMocks.getCodexModelCatalog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        accessToken: "next-token",
        accountId: "acc_next"
      })
    )
    expect(setCatalogModels).toHaveBeenNthCalledWith(2, "account:acc_next", [{ slug: "gpt-5.4-codex" }])
    expect(activateCatalogScope).toHaveBeenCalledTimes(1)
  })

  it("clears the applied catalog when a refresh returns undefined", async () => {
    catalogSyncMocks.getOpenAIOAuthDomain.mockReturnValue({
      strategy: "sticky",
      activeIdentityKey: "acc_seed",
      accounts: [{ identityKey: "acc_seed" }]
    })
    catalogSyncMocks.selectAccount.mockReturnValue({
      access: "seed-token",
      accountId: "acc_seed",
      expires: Date.now() + 10_000
    })
    catalogSyncMocks.getCodexModelCatalog
      .mockResolvedValueOnce([{ slug: "gpt-5.3-codex" }])
      .mockResolvedValueOnce(undefined)

    const { initializeCatalogSync } = await import("../lib/codex-native/catalog-sync.js")

    let lastCatalogModels: Array<{ slug: string }> | undefined
    const syncCatalogFromAuth = await initializeCatalogSync({
      authMode: "native",
      pidOffsetEnabled: false,
      resolveCatalogHeaders: () => ({
        originator: "opencode",
        userAgent: "opencode/test",
        clientVersion: "0.0.0",
        versionHeader: "0.0.0"
      }),
      activateCatalogScope: () => {},
      setCatalogModels: (_scopeKey, models) => {
        lastCatalogModels = models as Array<{ slug: string }> | undefined
      }
    })

    expect(lastCatalogModels).toEqual([{ slug: "gpt-5.3-codex" }])

    await expect(syncCatalogFromAuth({ accessToken: "missing-now", accountId: "acc_next" })).resolves.toBeUndefined()

    expect(lastCatalogModels).toBeUndefined()
  })

  it("does not reactivate another scope when a background refresh completes", async () => {
    catalogSyncMocks.getOpenAIOAuthDomain.mockReturnValue({
      strategy: "sticky",
      activeIdentityKey: "acc_seed",
      accounts: [{ identityKey: "acc_seed" }]
    })
    catalogSyncMocks.selectAccount.mockReturnValue({
      access: "seed-token",
      accountId: "acc_seed",
      expires: Date.now() + 10_000
    })
    catalogSyncMocks.getCodexModelCatalog
      .mockResolvedValueOnce([{ slug: "gpt-5.3-codex" }])
      .mockResolvedValueOnce([{ slug: "gpt-5.4-codex" }])

    const { initializeCatalogSync } = await import("../lib/codex-native/catalog-sync.js")

    const activateCatalogScope = vi.fn()
    const setCatalogModels = vi.fn()
    const syncCatalogFromAuth = await initializeCatalogSync({
      authMode: "native",
      pidOffsetEnabled: false,
      resolveCatalogHeaders: () => ({
        originator: "opencode",
        userAgent: "opencode/test",
        clientVersion: "0.0.0",
        versionHeader: "0.0.0"
      }),
      setCatalogModels,
      activateCatalogScope
    })

    await syncCatalogFromAuth({ accessToken: "scope-b", accountId: "acc_b" })

    expect(setCatalogModels).toHaveBeenNthCalledWith(2, "account:acc_b", [{ slug: "gpt-5.4-codex" }])
    expect(activateCatalogScope).toHaveBeenCalledTimes(1)
  })

  it("falls back to accountId when selected token expiry is zero or non-finite", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000)
    catalogSyncMocks.getOpenAIOAuthDomain.mockReturnValue({
      strategy: "round_robin",
      accounts: [{ identityKey: "a" }]
    })
    catalogSyncMocks.selectAccount.mockReturnValueOnce({
      access: "token",
      accountId: "acc_1",
      expires: 0
    })

    const { selectCatalogAuthCandidate } = await import("../lib/codex-native/catalog-sync.js")
    await expect(selectCatalogAuthCandidate("native", false)).resolves.toEqual({ accountId: "acc_1" })

    vi.resetModules()
    catalogSyncMocks.getOpenAIOAuthDomain.mockReturnValue({
      strategy: "round_robin",
      accounts: [{ identityKey: "a" }]
    })
    catalogSyncMocks.selectAccount.mockReturnValueOnce({
      access: "token",
      accountId: "acc_2",
      expires: Number.NaN
    })
    const { selectCatalogAuthCandidate: selectCatalogAuthCandidateAgain } = await import(
      "../lib/codex-native/catalog-sync.js"
    )
    await expect(selectCatalogAuthCandidateAgain("native", false)).resolves.toEqual({ accountId: "acc_2" })
  })

  it("returns access token only for finite future expiry", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000)
    catalogSyncMocks.getOpenAIOAuthDomain.mockReturnValue({
      strategy: "round_robin",
      accounts: [{ identityKey: "a" }]
    })
    catalogSyncMocks.selectAccount.mockReturnValue({
      access: "token",
      accountId: "acc_ok",
      expires: 5_000
    })

    const { selectCatalogAuthCandidate } = await import("../lib/codex-native/catalog-sync.js")
    await expect(selectCatalogAuthCandidate("native", false)).resolves.toEqual({
      accessToken: "token",
      accountId: "acc_ok"
    })
  })
})
