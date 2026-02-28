import { afterEach, describe, expect, it, vi } from "vitest"

describe("catalog sync", () => {
  afterEach(() => {
    vi.resetModules()
    vi.unmock("../lib/codex-native/catalog-auth.js")
    vi.unmock("../lib/model-catalog.js")
  })

  it("bootstraps with selected auth candidate and applies refreshed catalogs", async () => {
    const selectCatalogAuthCandidate = vi.fn(async () => ({
      accessToken: "seed-token",
      accountId: "acc_seed"
    }))
    const getCodexModelCatalog = vi
      .fn()
      .mockResolvedValueOnce([{ slug: "gpt-5.3-codex" }])
      .mockResolvedValueOnce([{ slug: "gpt-5.4-codex" }])
    const applyCodexCatalogToProviderModels = vi.fn()

    vi.doMock("../lib/codex-native/catalog-auth.js", () => ({
      selectCatalogAuthCandidate
    }))
    vi.doMock("../lib/model-catalog.js", () => ({
      getCodexModelCatalog,
      applyCodexCatalogToProviderModels
    }))

    const { initializeCatalogSync } = await import("../lib/codex-native/catalog-sync.js")

    const providerModels: Record<string, Record<string, unknown>> = { openai: {} }
    let lastCatalogModels: Array<{ slug: string }> | undefined

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
      providerModels,
      fallbackModels: ["gpt-5.3-codex"],
      getLastCatalogModels: () => lastCatalogModels,
      setLastCatalogModels: (models) => {
        lastCatalogModels = models as Array<{ slug: string }> | undefined
      }
    })

    expect(selectCatalogAuthCandidate).toHaveBeenCalledWith("native", false, "sticky")
    expect(getCodexModelCatalog).toHaveBeenCalledTimes(1)
    expect(getCodexModelCatalog).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "seed-token",
        accountId: "acc_seed",
        originator: "opencode"
      })
    )
    expect(applyCodexCatalogToProviderModels).toHaveBeenCalledWith(
      expect.objectContaining({
        providerModels,
        fallbackModels: ["gpt-5.3-codex"],
        catalogModels: [{ slug: "gpt-5.3-codex" }]
      })
    )

    await expect(syncCatalogFromAuth({})).resolves.toBeUndefined()
    expect(getCodexModelCatalog).toHaveBeenCalledTimes(1)

    await expect(syncCatalogFromAuth({ accessToken: "next-token", accountId: "acc_next" })).resolves.toEqual([
      { slug: "gpt-5.4-codex" }
    ])
    expect(getCodexModelCatalog).toHaveBeenCalledTimes(2)
    expect(getCodexModelCatalog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        accessToken: "next-token",
        accountId: "acc_next"
      })
    )
    expect(applyCodexCatalogToProviderModels).toHaveBeenCalledTimes(2)
  })
})
