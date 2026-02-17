import { loadAuthStorage } from "./storage"
import { loadSnapshots } from "./codex-status-storage"
import { renderDashboard, type StatusRenderStyle } from "./codex-status-ui"
import { defaultAuthPath, defaultSnapshotsPath } from "./paths"
import { shouldUseColor } from "./ui/tty/ansi"

/**
 * Returns a human-readable string summarizing the status of all Codex accounts.
 * Includes usage snapshots if available on disk.
 */
export async function toolOutputForStatus(
  authPath: string = defaultAuthPath(),
  snapshotsPath: string = defaultSnapshotsPath(),
  options: { style?: StatusRenderStyle; useColor?: boolean } = {}
): Promise<string> {
  const authFile = await loadAuthStorage(authPath, { lockReads: false })
  const snapshots = await loadSnapshots(snapshotsPath)
  const style = options.style ?? "plain"
  const useColor = options.useColor ?? (style === "menu" ? shouldUseColor() : false)

  const openai = authFile.openai
  if (!openai || openai.type !== "oauth" || !("accounts" in openai)) {
    return "No Codex accounts configured."
  }

  const displayAccounts = openai.accounts.map((acc) => ({
    identityKey: acc.identityKey,
    accountId: acc.accountId,
    email: acc.email,
    plan: acc.plan,
    enabled: acc.enabled,
    expires: acc.expires,
    cooldownUntil: acc.cooldownUntil,
    lastUsed: acc.lastUsed
  }))

  const dashboardLines = renderDashboard(
    {
      accounts: displayAccounts,
      activeIdentityKey: openai.activeIdentityKey,
      snapshots
    },
    {
      style,
      useColor
    }
  )

  return dashboardLines.join("\n").trim()
}
