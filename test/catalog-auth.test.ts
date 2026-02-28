import { afterEach, describe, expect, it, vi } from "vitest"

describe("catalog auth candidate selection", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    vi.unmock("../lib/storage.js")
    vi.unmock("../lib/rotation.js")
  })

  function mockCatalogSelection(selected: { access?: string; accountId?: string; expires?: number }) {
    const loadAuthStorage = vi.fn(async () => ({}))
    const getOpenAIOAuthDomain = vi.fn(() => ({
      strategy: "round_robin" as const,
      accounts: [{ identityKey: "a" }]
    }))
    const selectAccount = vi.fn(() => selected)

    vi.doMock("../lib/storage.js", () => ({
      loadAuthStorage,
      getOpenAIOAuthDomain
    }))
    vi.doMock("../lib/rotation.js", () => ({
      selectAccount
    }))
  }

  it("falls back to accountId when selected token expiry is zero or non-finite", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000)
    mockCatalogSelection({
      access: "token",
      accountId: "acc_1",
      expires: 0
    })

    const { selectCatalogAuthCandidate } = await import("../lib/codex-native/catalog-auth.js")
    await expect(selectCatalogAuthCandidate("native", false)).resolves.toEqual({ accountId: "acc_1" })

    vi.resetModules()
    mockCatalogSelection({
      access: "token",
      accountId: "acc_2",
      expires: Number.NaN
    })
    const { selectCatalogAuthCandidate: selectCatalogAuthCandidateAgain } = await import(
      "../lib/codex-native/catalog-auth.js"
    )
    await expect(selectCatalogAuthCandidateAgain("native", false)).resolves.toEqual({ accountId: "acc_2" })
  })

  it("returns access token only for finite future expiry", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000)
    mockCatalogSelection({
      access: "token",
      accountId: "acc_ok",
      expires: 5_000
    })

    const { selectCatalogAuthCandidate } = await import("../lib/codex-native/catalog-auth.js")
    await expect(selectCatalogAuthCandidate("native", false)).resolves.toEqual({
      accessToken: "token",
      accountId: "acc_ok"
    })
  })
})
