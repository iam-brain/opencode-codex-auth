import { describe, expect, it } from "vitest"

import { runCodexInVivoQuotaProbe } from "./helpers/codex-quota-in-vivo"

describe("codex quota in-vivo", () => {
  const enabled = process.env.CODEX_IN_VIVO === "1"

  it.skipIf(!enabled)("probes live account quota snapshots with account-scoped headers", async () => {
    const rows = await runCodexInVivoQuotaProbe()
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => typeof row.identityKey === "string" && row.identityKey.length > 0)).toBe(
      true
    )
    expect(rows.some((row) => row.snapshot !== null)).toBe(true)
  })
})
