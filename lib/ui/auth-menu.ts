import { ANSI, shouldUseColor } from "./tty/ansi"
import { confirm } from "./tty/confirm"
import { select, type MenuItem } from "./tty/select"

export type AccountStatus = "active" | "rate-limited" | "expired" | "unknown"
export type AccountAuthType = "native" | "codex"
export type DeleteScope = AccountAuthType | "both"

export interface AccountInfo {
  identityKey?: string
  email?: string
  plan?: string
  accountId?: string
  authTypes?: AccountAuthType[]
  index: number
  addedAt?: number
  lastUsed?: number
  status?: AccountStatus
  isCurrentAccount?: boolean
  enabled?: boolean
}

export type AuthMenuAction =
  | { type: "add" }
  | { type: "select-account"; account: AccountInfo }
  | { type: "delete-all"; scope: DeleteScope }
  | { type: "check" }
  | { type: "manage" }
  | { type: "configure-models" }
  | { type: "transfer" }
  | { type: "cancel" }

export type AccountAction =
  | { type: "back" }
  | { type: "delete"; scope: DeleteScope }
  | { type: "delete-all"; scope: DeleteScope }
  | { type: "refresh" }
  | { type: "toggle" }
  | { type: "cancel" }

const AUTH_TYPE_ORDER: AccountAuthType[] = ["native", "codex"]

function normalizeAccountAuthTypes(input: readonly AccountAuthType[] | undefined): AccountAuthType[] {
  const seen = new Set<AccountAuthType>()
  const out: AccountAuthType[] = []

  for (const type of input ?? ["native"]) {
    if (type !== "native" && type !== "codex") continue
    if (seen.has(type)) continue
    seen.add(type)
    out.push(type)
  }

  if (out.length === 0) return ["native"]
  out.sort((a, b) => AUTH_TYPE_ORDER.indexOf(a) - AUTH_TYPE_ORDER.indexOf(b))
  return out
}

function displayAuthType(type: AccountAuthType): string {
  return type === "codex" ? "Codex" : "Native"
}

export function formatAccountAuthTypes(input: readonly AccountAuthType[] | undefined): string {
  return normalizeAccountAuthTypes(input).map(displayAuthType).join("+")
}

function getDeleteScopes(input: readonly AccountAuthType[] | undefined): DeleteScope[] {
  const authTypes = normalizeAccountAuthTypes(input)
  if (authTypes.length === 1) return [authTypes[0]]
  return ["native", "codex", "both"]
}

function scopeLabel(scope: DeleteScope): string {
  if (scope === "native") return "Native"
  if (scope === "codex") return "Codex"
  return "all auth types"
}

function authTypesFromAccounts(accounts: AccountInfo[]): AccountAuthType[] {
  const seen = new Set<AccountAuthType>()
  for (const account of accounts) {
    for (const type of normalizeAccountAuthTypes(account.authTypes)) {
      seen.add(type)
    }
  }
  const out = Array.from(seen)
  out.sort((a, b) => AUTH_TYPE_ORDER.indexOf(a) - AUTH_TYPE_ORDER.indexOf(b))
  return out.length > 0 ? out : ["native"]
}

export function formatRelativeTime(timestamp: number | undefined, now = Date.now()): string {
  if (!timestamp) return "never"
  const days = Math.floor((now - timestamp) / 86_400_000)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return new Date(timestamp).toLocaleDateString()
}

function formatDate(timestamp: number | undefined): string {
  if (!timestamp) return "unknown"
  return new Date(timestamp).toLocaleDateString()
}

function colorize(text: string, color: string, useColor: boolean): string {
  return useColor ? `${color}${text}${ANSI.reset}` : text
}

function formatAccountDisplayName(account: AccountInfo): string {
  const base = account.email || `Account ${account.index + 1}`
  const plan = typeof account.plan === "string" ? account.plan.trim() : ""
  return plan ? `${base} (${plan})` : base
}

function getStatusBadge(status: AccountStatus | undefined, useColor: boolean): string {
  switch (status) {
    case "rate-limited":
      return colorize("[rate-limited]", ANSI.yellow, useColor)
    case "expired":
      return colorize("[expired]", ANSI.red, useColor)
    default:
      return ""
  }
}

export function formatStatusBadges(
  account: Pick<AccountInfo, "enabled" | "status" | "isCurrentAccount">,
  useColor = shouldUseColor()
): string {
  const badges: string[] = []
  if (account.enabled === false) {
    badges.push(colorize("[disabled]", ANSI.red, useColor))
  } else {
    badges.push(colorize("[enabled]", ANSI.green, useColor))
  }
  const statusBadge = getStatusBadge(account.status, useColor)
  if (statusBadge) badges.push(statusBadge)
  if (account.isCurrentAccount) {
    badges.push(colorize("[last active]", ANSI.cyan, useColor))
  }
  return badges.join(" ")
}

function buildAccountLabel(account: AccountInfo, useColor: boolean): string {
  const baseLabel = formatAccountDisplayName(account)
  const accountAuthTypes = colorize(`[${formatAccountAuthTypes(account.authTypes)}]`, ANSI.cyan, useColor)
  const badges = formatStatusBadges(account, useColor)
  return badges ? `${baseLabel} ${accountAuthTypes} ${badges}` : `${baseLabel} ${accountAuthTypes}`
}

export function buildAuthMenuItems(
  accounts: AccountInfo[],
  options: { useColor?: boolean; allowTransfer?: boolean } = {}
): MenuItem<AuthMenuAction>[] {
  const useColor = options.useColor ?? shouldUseColor()
  const items: MenuItem<AuthMenuAction>[] = [
    { label: "Add new account", value: { type: "add" } },
    { label: "Check quotas", value: { type: "check" } },
    { label: "Manage accounts (enable/disable)", value: { type: "manage" } },
    { label: "Configure models in codex-config.json", value: { type: "configure-models" } },
    ...(options.allowTransfer
      ? [
          {
            label: "Transfer OpenAI accounts from native & old plugins?",
            value: { type: "transfer" as const }
          }
        ]
      : []),
    ...accounts.map((account) => {
      const label = buildAccountLabel(account, useColor)
      return {
        label,
        hint: account.lastUsed ? `used ${formatRelativeTime(account.lastUsed)}` : "",
        value: { type: "select-account" as const, account }
      }
    })
  ]
  if (accounts.length > 0) {
    items.push({
      label: "Delete all accounts",
      value: { type: "delete-all", scope: "both" },
      color: "red"
    })
  }

  return items
}

export function buildAccountActionItems(
  account: AccountInfo,
  options: { availableAuthTypes?: AccountAuthType[] } = {}
): MenuItem<AccountAction>[] {
  const accountScopes = getDeleteScopes(account.authTypes)
  const globalScopes = getDeleteScopes(options.availableAuthTypes ?? account.authTypes)

  const accountDeleteItems: MenuItem<AccountAction>[] = []
  if (accountScopes.length === 1) {
    accountDeleteItems.push({
      label: `Delete this account (${scopeLabel(accountScopes[0])})`,
      value: { type: "delete", scope: accountScopes[0] },
      color: "red"
    })
  } else {
    accountDeleteItems.push(
      {
        label: "Delete Native auth from this account",
        value: { type: "delete", scope: "native" },
        color: "red"
      },
      {
        label: "Delete Codex auth from this account",
        value: { type: "delete", scope: "codex" },
        color: "red"
      },
      {
        label: "Delete this account (all auth types)",
        value: { type: "delete", scope: "both" },
        color: "red"
      }
    )
  }

  const globalDeleteItems: MenuItem<AccountAction>[] = []
  if (globalScopes.length === 1) {
    globalDeleteItems.push({
      label: `Delete all accounts (${scopeLabel(globalScopes[0])})`,
      value: { type: "delete-all", scope: globalScopes[0] },
      color: "red"
    })
  } else {
    globalDeleteItems.push(
      {
        label: "Delete all Native accounts",
        value: { type: "delete-all", scope: "native" },
        color: "red"
      },
      {
        label: "Delete all Codex accounts",
        value: { type: "delete-all", scope: "codex" },
        color: "red"
      },
      {
        label: "Delete all accounts (all auth types)",
        value: { type: "delete-all", scope: "both" },
        color: "red"
      }
    )
  }

  return [
    { label: "Back", value: { type: "back" } },
    {
      label: account.enabled === false ? "Enable account" : "Disable account",
      value: { type: "toggle" },
      color: account.enabled === false ? "green" : "yellow"
    },
    {
      label: "Refresh token",
      value: { type: "refresh" },
      color: "cyan",
      disabled: account.enabled === false
    },
    ...accountDeleteItems,
    ...globalDeleteItems
  ]
}

export function buildAccountSelectItems(accounts: AccountInfo[], useColor = shouldUseColor()): MenuItem<AccountInfo>[] {
  return accounts.map((account) => ({
    label: buildAccountLabel(account, useColor),
    hint: account.lastUsed ? `used ${formatRelativeTime(account.lastUsed)}` : "",
    value: account
  }))
}

export async function selectAccount(
  accounts: AccountInfo[],
  options: { input?: NodeJS.ReadStream; output?: NodeJS.WriteStream; useColor?: boolean } = {}
): Promise<AccountInfo | null> {
  const useColor = options.useColor ?? shouldUseColor()
  const items = buildAccountSelectItems(accounts, useColor)
  const result = await select(items, {
    message: "Manage accounts",
    subtitle: "Select account",
    input: options.input,
    output: options.output,
    useColor
  })
  return result ?? null
}

export async function showAuthMenu(
  accounts: AccountInfo[],
  options: {
    input?: NodeJS.ReadStream
    output?: NodeJS.WriteStream
    useColor?: boolean
    allowTransfer?: boolean
  } = {}
): Promise<AuthMenuAction> {
  const useColor = options.useColor ?? shouldUseColor()
  const items = buildAuthMenuItems(accounts, {
    useColor,
    allowTransfer: options.allowTransfer === true
  })

  while (true) {
    const result = await select(items, {
      message: "Manage accounts",
      subtitle: "Select account",
      input: options.input,
      output: options.output,
      useColor
    })

    if (!result) return { type: "cancel" }
    if (result.type === "delete-all") {
      const menuAuthTypes = authTypesFromAccounts(accounts)
      let scope: DeleteScope
      const scopes = getDeleteScopes(menuAuthTypes)

      if (scopes.length === 1) {
        scope = scopes[0]
      } else {
        const scopeSelection = await select(
          [
            { label: "Delete all Native accounts", value: "native" as const, color: "red" },
            { label: "Delete all Codex accounts", value: "codex" as const, color: "red" },
            { label: "Delete all accounts (all auth types)", value: "both" as const, color: "red" }
          ],
          {
            message: "Delete accounts",
            subtitle: "Choose scope",
            input: options.input,
            output: options.output,
            useColor
          }
        )
        if (!scopeSelection) continue
        scope = scopeSelection
      }

      const confirmed = await confirm(
        `Delete ALL ${scopeLabel(scope)} accounts? This cannot be undone.`,
        false,
        options
      )
      if (!confirmed) continue
      return { type: "delete-all", scope }
    }

    return result
  }
}

export async function showAccountDetails(
  account: AccountInfo,
  options: {
    input?: NodeJS.ReadStream
    output?: NodeJS.WriteStream
    useColor?: boolean
    availableAuthTypes?: AccountAuthType[]
  } = {}
): Promise<AccountAction> {
  const useColor = options.useColor ?? shouldUseColor()
  const output = options.output ?? process.stdout
  const label = formatAccountDisplayName(account)
  const badges = formatStatusBadges(account, useColor)

  const bold = useColor ? ANSI.bold : ""
  const dim = useColor ? ANSI.dim : ""
  const reset = useColor ? ANSI.reset : ""

  output.write("\n")
  output.write(`${bold}Account: ${label}${badges ? ` ${badges}` : ""}${reset}\n`)
  output.write(`${dim}Added: ${formatDate(account.addedAt)}${reset}\n`)
  output.write(`${dim}Last used: ${formatRelativeTime(account.lastUsed)}${reset}\n`)
  output.write("\n")

  while (true) {
    const actionItems = buildAccountActionItems(account, {
      availableAuthTypes: options.availableAuthTypes
    })
    const selected = await select(actionItems, {
      message: "Account options",
      subtitle: "Select action",
      input: options.input,
      output: options.output,
      useColor
    })

    if (!selected) return { type: "cancel" }

    if (selected.type === "delete") {
      const confirmed = await confirm(
        selected.scope === "both" ? `Delete ${label}?` : `Delete ${scopeLabel(selected.scope)} auth from ${label}?`,
        false,
        options
      )
      if (!confirmed) continue
    }

    if (selected.type === "delete-all") {
      const confirmed = await confirm(
        `Delete ALL ${scopeLabel(selected.scope)} accounts? This cannot be undone.`,
        false,
        options
      )
      if (!confirmed) continue
    }

    if (selected.type === "refresh") {
      const confirmed = await confirm(`Re-authenticate ${label}?`, false, options)
      if (!confirmed) continue
    }

    return selected
  }
}
