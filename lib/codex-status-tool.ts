import { loadAuthStorage } from "./storage"
import { loadSnapshots } from "./codex-status-storage"
import { renderDashboard } from "./codex-status-ui"
import { defaultAuthPath, defaultSnapshotsPath } from "./paths"

/**
 * Returns a human-readable string summarizing the status of all Codex accounts.
 * Includes usage snapshots if available on disk.
 */
export async function toolOutputForStatus(
  authPath: string = defaultAuthPath(),
  snapshotsPath: string = defaultSnapshotsPath()
): Promise<string> {
  const authFile = await loadAuthStorage(authPath)
  const snapshots = await loadSnapshots(snapshotsPath)

  const openai = authFile.openai
  if (!openai || openai.type !== "oauth" || !("accounts" in openai)) {
    return "No Codex accounts configured."
  }

  const lines: string[] = []
  lines.push("## Codex Status")
  lines.push("")

  const displayAccounts = openai.accounts.map((acc) => ({
    identityKey: acc.identityKey,
    accountId: acc.accountId,
    email: acc.email,
    plan: acc.plan,
    enabled: acc.enabled,
    cooldownUntil: acc.cooldownUntil,
    lastUsed: acc.lastUsed
  }))

  const dashboardLines = renderDashboard({
    accounts: displayAccounts,
    activeIdentityKey: openai.activeIdentityKey,
    snapshots
  })

  lines.push(...dashboardLines)
  lines.push("")
  lines.push("---")
  lines.push(`Auth: ${authPath}`)
  lines.push(`Snapshots: ${snapshotsPath}`)

  return lines.join("\n").trim()
}
