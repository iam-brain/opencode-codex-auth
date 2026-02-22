import type { CodexRateLimitSnapshot, AccountRecord, CodexLimit } from "./types.js"
import { ANSI } from "./ui/tty/ansi.js"

const FULL_BLOCK = "█"
const EMPTY_BLOCK = "░"

export type StatusRenderStyle = "plain" | "menu"

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

function colorize(text: string, color: string, useColor: boolean): string {
  return useColor ? `${color}${text}${ANSI.reset}` : text
}

function colorForPct(pct: number): string {
  if (pct <= 10) return ANSI.red
  if (pct < 40) return ANSI.yellow
  return ANSI.green
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
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `resets ${timeStr} ${date.getDate()} ${months[date.getMonth()]}`
}

function findLimitByName(snap: CodexRateLimitSnapshot, names: string[]): (typeof snap.limits)[number] | undefined {
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
  const fiveHour = findLimitByName(snap, ["5h", "primary", "requests"]) ?? snap.limits[0]
  const weekly =
    findLimitByName(snap, ["weekly", "secondary", "tokens"]) ??
    snap.limits.find((limit) => limit !== fiveHour) ??
    snap.limits[1]
  return { fiveHour, weekly }
}

function formatAccountLabel(input: {
  account: AccountRecord
  activeIdentityKey?: string
  useColor: boolean
  withBadges: boolean
}): string {
  const label = input.account.email ?? input.account.identityKey ?? "account"
  const plan = input.account.plan ? ` (${input.account.plan})` : ""
  const missingIdentityBadge = input.account.identityKey ? "" : " [identity-missing]"
  if (!input.withBadges) return `${label}${plan}${missingIdentityBadge}`

  const badges: string[] = []
  if (input.account.enabled === false) {
    badges.push(colorize("[disabled]", ANSI.red, input.useColor))
  } else {
    badges.push(colorize("[enabled]", ANSI.green, input.useColor))
  }

  if (input.account.identityKey && input.activeIdentityKey === input.account.identityKey) {
    badges.push(colorize("[last active]", ANSI.cyan, input.useColor))
  }

  if (!input.account.identityKey) {
    badges.push(colorize("[identity-missing]", ANSI.yellow, input.useColor))
  }

  const suffix = badges.length > 0 ? ` ${badges.join(" ")}` : ""
  return `${label}${plan}${suffix}`
}

function renderQuotaLine(input: {
  prefix: string
  label: string
  leftPct: number
  resetText?: string
  useColor: boolean
}): string {
  const pct = clampPct(input.leftPct)
  const pctText = `${String(pct).padStart(3, " ")}%`
  const resetSuffix = input.resetText ? ` (${input.resetText})` : ""
  const color = colorForPct(pct)
  const barText = colorize(`[${renderBar(pct)}]`, color, input.useColor)
  const coloredPctText = colorize(pctText, color, input.useColor)
  return `${input.prefix}${input.label.padEnd(7)} ${barText} ${coloredPctText} left${resetSuffix}`
}

function fallbackResetLabel(expired: boolean): string {
  return expired ? "Unknown, account expired" : "Unknown, no snapshot yet"
}

function fallbackResetLabelForAccount(input: { expired: boolean; identityMissing: boolean }): string {
  if (input.identityMissing) return "Unknown, missing identity metadata"
  return fallbackResetLabel(input.expired)
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

export function renderDashboard(
  input: {
    accounts: AccountRecord[]
    activeIdentityKey?: string
    snapshots: Record<string, CodexRateLimitSnapshot | undefined>
  },
  options: { style?: StatusRenderStyle; useColor?: boolean } = {}
): string[] {
  const style = options.style ?? "plain"
  const useColor = options.useColor === true
  const lines: string[] = []

  if (style === "plain") {
    lines.push("Codex quotas")
    lines.push("")
  } else {
    lines.push(`${colorize("┌", ANSI.dim, useColor)}  Quota snapshot`)
    lines.push(colorize("│", ANSI.cyan, useColor))
    lines.push(`${colorize("◆", ANSI.cyan, useColor)}  Accounts`)
    lines.push(colorize("│", ANSI.cyan, useColor))
  }

  if (input.accounts.length === 0) {
    if (style === "menu") {
      lines.push(`${colorize("│", ANSI.cyan, useColor)}  No Codex accounts configured.`)
      lines.push(colorize("└", ANSI.cyan, useColor))
      return lines
    }
    lines.push("No Codex accounts configured.")
    return lines
  }

  const renderableAccounts = input.accounts
  for (let i = 0; i < renderableAccounts.length; i += 1) {
    const acc = renderableAccounts[i]
    const snap = acc.identityKey ? input.snapshots[acc.identityKey] : undefined
    const accountLabel = formatAccountLabel({
      account: acc,
      activeIdentityKey: input.activeIdentityKey,
      useColor,
      withBadges: style === "menu"
    })

    if (style === "menu") {
      lines.push(`${colorize("│", ANSI.cyan, useColor)}  ${colorize("●", ANSI.green, useColor)} ${accountLabel}`)
    } else {
      lines.push(accountLabel)
    }

    const expired = typeof acc.expires === "number" && Number.isFinite(acc.expires) && acc.expires <= Date.now()

    const rows = resolveQuotaRows(snap)
    lines.push(
      renderQuotaLine({
        prefix: style === "menu" ? `${colorize("│", ANSI.cyan, useColor)}  ├─ ` : "├─ ",
        label: "5h",
        leftPct: rows.fiveHour?.leftPct ?? 0,
        resetText: rows.fiveHour
          ? (formatResetTimestamp(rows.fiveHour.resetsAt) ?? "Unknown")
          : fallbackResetLabelForAccount({ expired, identityMissing: !acc.identityKey }),
        useColor
      })
    )
    lines.push(
      renderQuotaLine({
        prefix: style === "menu" ? `${colorize("│", ANSI.cyan, useColor)}  ├─ ` : "├─ ",
        label: "Weekly",
        leftPct: rows.weekly?.leftPct ?? 0,
        resetText: rows.weekly
          ? (formatResetTimestamp(rows.weekly.resetsAt) ?? "Unknown")
          : fallbackResetLabelForAccount({ expired, identityMissing: !acc.identityKey }),
        useColor
      })
    )
    const creditsText = formatCredits(snap)
    const creditsColor = creditsText === "0 credits" ? ANSI.red : creditsText === "unlimited" ? ANSI.cyan : ANSI.green
    const colorizedCredits = colorize(creditsText, creditsColor, useColor)
    lines.push(`${style === "menu" ? `${colorize("│", ANSI.cyan, useColor)}  └─ ` : "└─ "}Credits ${colorizedCredits}`)

    if (style === "menu" && i < renderableAccounts.length - 1) {
      lines.push(colorize("│", ANSI.cyan, useColor))
    } else if (style !== "menu") {
      lines.push("")
    }
  }

  if (style === "menu") {
    lines.push(colorize("└", ANSI.cyan, useColor))
  } else if (lines[lines.length - 1] === "") {
    lines.pop()
  }
  return lines
}
