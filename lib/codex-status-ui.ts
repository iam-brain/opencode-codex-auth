import type { CodexRateLimitSnapshot, AccountRecord } from "./types"

export function renderDashboard(input: {
  accounts: AccountRecord[]
  activeIdentityKey?: string
  snapshots: Record<string, CodexRateLimitSnapshot | undefined>
}): string[] {
  const lines: string[] = []
  for (const acc of input.accounts) {
    const key = acc.identityKey
    if (!key) continue

    const snap = input.snapshots[key]
    const active = input.activeIdentityKey === key ? "*" : " "
    const label = acc.email ?? key

    lines.push(`${active} ${label} (${acc.plan ?? "unknown"})`)

    if (!snap) {
      lines.push("  (no snapshot)")
      continue
    }

    for (const lim of snap.limits) {
      lines.push(`  ${lim.name}: ${lim.leftPct}% left`)
    }
  }
  return lines
}
