import { describe, expect, it, vi } from "vitest"

import { runCodexInVivoQuotaProbe } from "./helpers/codex-quota-in-vivo"

const enabled = process.env.CODEX_IN_VIVO === "1"
describe("codex quota in-vivo", () => {
  const liveIt = enabled ? it : it.skip

  liveIt("probes live account quota snapshots with account-scoped headers", async () => {
    const rows = await runCodexInVivoQuotaProbe()
    expect(rows.length).toBeGreaterThan(0)
    const identityKeys = rows.map((row) => row.identityKey)
    expect(new Set(identityKeys).size).toBe(identityKeys.length)
    for (const identityKey of identityKeys) {
      expect(identityKey.length).toBeGreaterThan(0)
    }
    expect(rows.some((row) => row.snapshot !== null)).toBe(true)
  })
})

describe("codex quota probe helper (deterministic)", () => {
  it("filters invalid rows, dedupes identities, and preserves account-scoped fetch args", async () => {
    const fetchQuotaSnapshotFromBackendImpl = vi.fn(async () => ({
      updatedAt: Date.now(),
      modelFamily: "gpt-5.3-codex",
      limits: []
    }))

    const rows = await runCodexInVivoQuotaProbe({
      loadAuthStorageImpl: async () =>
        ({
          openai: {
            type: "oauth",
            accounts: [
              { identityKey: "acc_1|one@example.com|plus", access: "token-1", accountId: "acc_1", enabled: true },
              {
                identityKey: "acc_1|one@example.com|plus",
                access: "token-1-dup",
                accountId: "acc_1",
                enabled: true
              },
              { identityKey: "acc_4|four@example.com|plus", access: "token-4", accountId: "acc_4", enabled: true },
              { identityKey: "acc_2|two@example.com|plus", access: "token-2", enabled: false },
              { identityKey: "acc_3|three@example.com|plus", enabled: true },
              { access: "token-4", enabled: true }
            ]
          }
        }) as any,
      fetchQuotaSnapshotFromBackendImpl
    })

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.identityKey)).toEqual([
      "acc_1|one@example.com|plus",
      "acc_4|four@example.com|plus"
    ])
    expect(fetchQuotaSnapshotFromBackendImpl).toHaveBeenCalledTimes(2)
    expect(fetchQuotaSnapshotFromBackendImpl).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        accessToken: "token-1",
        accountId: "acc_1",
        modelFamily: "gpt-5.3-codex",
        userAgent: "codex_cli_rs"
      })
    )
    expect(fetchQuotaSnapshotFromBackendImpl).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        accessToken: "token-4",
        accountId: "acc_4",
        modelFamily: "gpt-5.3-codex",
        userAgent: "codex_cli_rs"
      })
    )
  })

  it("returns empty rows when auth has no oauth account collection", async () => {
    const rows = await runCodexInVivoQuotaProbe({
      loadAuthStorageImpl: async () => ({})
    })
    expect(rows).toEqual([])
  })
})
