import type { AccountAuthType, AccountInfo, DeleteScope } from "./auth-menu.js"
import { showAccountDetails, showAuthMenu, selectAccount } from "./auth-menu.js"

export type AuthMenuHandlers = {
  onCheckQuotas: () => Promise<void>
  onConfigureModels: () => Promise<void>
  onDeleteAll: (scope: DeleteScope) => Promise<void>
  onTransfer: () => Promise<void>
  onToggleAccount: (account: AccountInfo) => Promise<void>
  onRefreshAccount: (account: AccountInfo) => Promise<void>
  onDeleteAccount: (account: AccountInfo, scope: DeleteScope) => Promise<void>
}

export type AuthMenuResult = "add" | "continue" | "exit"

function collectAuthTypes(accounts: AccountInfo[]): AccountAuthType[] {
  const out: AccountAuthType[] = []
  const seen = new Set<AccountAuthType>()

  for (const account of accounts) {
    const authTypes = account.authTypes && account.authTypes.length > 0 ? account.authTypes : ["native"]
    for (const authType of authTypes) {
      if (authType !== "native" && authType !== "codex") continue
      if (seen.has(authType)) continue
      seen.add(authType)
      out.push(authType)
    }
  }

  if (out.length === 0) out.push("native")
  return out
}

export async function runAuthMenuOnce(args: {
  accounts: AccountInfo[]
  handlers: AuthMenuHandlers
  allowTransfer?: boolean
  input?: NodeJS.ReadStream
  output?: NodeJS.WriteStream
}): Promise<AuthMenuResult> {
  const action = await showAuthMenu(args.accounts, {
    input: args.input,
    output: args.output,
    allowTransfer: args.allowTransfer
  })

  if (action.type === "cancel") return "exit"
  if (action.type === "add") return "add"
  if (action.type === "check") {
    await args.handlers.onCheckQuotas()
    return "continue"
  }
  if (action.type === "configure-models") {
    await args.handlers.onConfigureModels()
    return "continue"
  }
  if (action.type === "transfer") {
    await args.handlers.onTransfer()
    return "continue"
  }
  if (action.type === "delete-all") {
    await args.handlers.onDeleteAll(action.scope)
    return "continue"
  }

  const account =
    action.type === "select-account"
      ? action.account
      : await selectAccount(args.accounts, {
          input: args.input,
          output: args.output
        })
  if (!account) return "continue"

  const accountAction = await showAccountDetails(account, {
    input: args.input,
    output: args.output,
    availableAuthTypes: collectAuthTypes(args.accounts)
  })

  if (accountAction.type === "toggle") {
    await args.handlers.onToggleAccount(account)
    return "continue"
  }
  if (accountAction.type === "refresh") {
    if (account.enabled !== false) {
      await args.handlers.onRefreshAccount(account)
    }
    return "continue"
  }
  if (accountAction.type === "delete") {
    await args.handlers.onDeleteAccount(account, accountAction.scope)
    return "continue"
  }
  if (accountAction.type === "delete-all") {
    await args.handlers.onDeleteAll(accountAction.scope)
    return "continue"
  }

  return "continue"
}
