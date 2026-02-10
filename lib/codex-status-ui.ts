import type { CodexRateLimitSnapshot, AccountRecord, CodexLimit } from "./types"

const FULL_BLOCK = "█"
const EMPTY_BLOCK = "░"

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 100) return 100
  return Math.round(value)
}

function renderBar(leftPct: number, width = 20): string {
  const safePct = clampPct(leftPct)
  const filled = Math.round((safePct / 100) * width)
  return `${FULL_BLOCK.repeat(filled)}${EMPTY_BLOCK.repeat(Math.max(0, width - filled))}`
}

function formatResetTimestamp(resetsAt: number | undefined, now = Date.now()): string | undefined {
  if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt) || resetsAt <= now) {
    return undefined
  }
  const date = new Date(resetsAt)
  const timeStr = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
  if (resetsAt - now <= 24 * 60 * 60 * 1000) {
    return `resets ${timeStr}`
  }
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ]
  return `resets ${timeStr} ${date.getDate()} ${months[date.getMonth()]}`
}

function findLimitByName(snap: CodexRateLimitSnapshot, names: string[]): typeof snap.limits[number] | undefined {
  const lowered = names.map((name) => name.toLowerCase())
  return snap.limits.find((limit) => lowered.includes(limit.name.toLowerCase()))
}

function resolveQuotaRows(snap: CodexRateLimitSnapshot | undefined): {
  fiveHour?: CodexLimit
  weekly?: CodexLimit
} {
  if (!snap) {
    return { fiveHour: undefined, weekly: undefined }
  }
  const fiveHour =
    findLimitByName(snap, ["5h", "primary", "requests"]) ??
    snap.limits[0]
  const weekly =
    findLimitByName(snap, ["weekly", "secondary", "tokens"]) ??
    snap.limits.find((limit) => limit !== fiveHour) ??
    snap.limits[1]
  return { fiveHour, weekly }
}

function renderQuotaLine(input: {
  label: string
  leftPct: number
  resetText?: string
}): string {
  const pct = clampPct(input.leftPct)
  const pctText = `${String(pct).padStart(3, " ")}%`
  const resetSuffix = input.resetText ? ` (${input.resetText})` : ""
  return `  ● ${input.label.padEnd(10)} [${renderBar(pct)}] ${pctText} left${resetSuffix}`
}

function fallbackResetLabel(expired: boolean): string {
  return expired ? "Unknown, account expired" : "Unknown, no snapshot yet"
}

function formatCredits(snap: CodexRateLimitSnapshot | undefined): string {
  const credits = snap?.credits
  if (!credits) return "0 credits"
  if (credits.unlimited) return "unlimited"
  if (typeof credits.balance === "string" && credits.balance.trim().length > 0) {
    return `${credits.balance.trim()} credits`
  }
  if (credits.hasCredits === false) return "0 credits"
  return "0 credits"
}

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

    const expired =
      typeof acc.expires === "number" && Number.isFinite(acc.expires) && acc.expires <= Date.now()

    const rows = resolveQuotaRows(snap)
    lines.push(
      renderQuotaLine({
        label: "5h",
        leftPct: rows.fiveHour?.leftPct ?? 0,
        resetText: rows.fiveHour
          ? formatResetTimestamp(rows.fiveHour.resetsAt) ?? "Unknown"
          : fallbackResetLabel(expired)
      })
    )
    lines.push(
      renderQuotaLine({
        label: "Weekly",
        leftPct: rows.weekly?.leftPct ?? 0,
        resetText: rows.weekly
          ? formatResetTimestamp(rows.weekly.resetsAt) ?? "Unknown"
          : fallbackResetLabel(expired)
      })
    )
    lines.push(`  ● Credits    ${formatCredits(snap)}`)
  }
  return lines
}
