import { fetchQuotaSnapshotFromBackend } from "../../lib/codex-quota-fetch"
import { defaultAuthPath } from "../../lib/paths"
import { loadAuthStorage } from "../../lib/storage"

export type QuotaInVivoProbeRow = {
  identityKey: string
  email?: string
  plan?: string
  accountId?: string
  snapshot: Awaited<ReturnType<typeof fetchQuotaSnapshotFromBackend>>
}

export async function runCodexInVivoQuotaProbe(input?: {
  authPath?: string
  modelFamily?: string
  userAgent?: string
}): Promise<QuotaInVivoProbeRow[]> {
  const auth = await loadAuthStorage(input?.authPath ?? defaultAuthPath())
  const openai = auth.openai
  if (!openai || openai.type !== "oauth" || !("accounts" in openai)) return []

  const rows: QuotaInVivoProbeRow[] = []
  for (const account of openai.accounts) {
    if (account.enabled === false) continue
    if (typeof account.identityKey !== "string" || account.identityKey.length === 0) continue
    if (typeof account.access !== "string" || account.access.length === 0) continue

    const snapshot = await fetchQuotaSnapshotFromBackend({
      accessToken: account.access,
      accountId: account.accountId,
      modelFamily: input?.modelFamily ?? "gpt-5.3-codex",
      userAgent: input?.userAgent ?? "codex_cli_rs"
    })

    rows.push({
      identityKey: account.identityKey,
      email: account.email,
      plan: account.plan,
      accountId: account.accountId,
      snapshot
    })
  }

  return rows
}
