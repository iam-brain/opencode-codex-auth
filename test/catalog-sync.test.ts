import { afterEach, describe, expect, it, vi } from "vitest"

const catalogSyncMocks = vi.hoisted(() => ({
  selectCatalogAuthCandidate: vi.fn(),
  getCodexModelCatalog: vi.fn()
}))

vi.doMock("../lib/codex-native/catalog-auth.js", () => ({
  selectCatalogAuthCandidate: catalogSyncMocks.selectCatalogAuthCandidate
}))

vi.doMock("../lib/model-catalog.js", () => ({
  getCodexModelCatalog: catalogSyncMocks.getCodexModelCatalog
}))

describe("catalog sync", () => {
  afterEach(() => {
    vi.resetModules()
    catalogSyncMocks.selectCatalogAuthCandidate.mockReset()
    catalogSyncMocks.getCodexModelCatalog.mockReset()
  })

  it("bootstraps with selected auth candidate and applies refreshed catalogs", async () => {
    catalogSyncMocks.selectCatalogAuthCandidate.mockResolvedValue({
      accessToken: "seed-token",
      accountId: "acc_seed"
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

    expect(catalogSyncMocks.selectCatalogAuthCandidate).toHaveBeenCalledWith("native", false, "sticky")
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
    catalogSyncMocks.selectCatalogAuthCandidate.mockResolvedValue({
      accessToken: "seed-token",
      accountId: "acc_seed"
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
    catalogSyncMocks.selectCatalogAuthCandidate.mockResolvedValue({
      accessToken: "seed-token",
      accountId: "acc_seed"
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
})
