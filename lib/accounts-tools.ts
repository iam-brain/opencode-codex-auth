import type { AccountRecord, OpenAIMultiOauthAuth } from "./types"

export type ToolAccountRow = {
  displayIndex: number // 1-based, matches tools
  identityKey: string
  email?: string
  plan?: string
  enabled: boolean
  isActive: boolean
}

type ToolAccountInternalRow = ToolAccountRow & {
  accountIndex: number
}

function buildToolRows(openai: OpenAIMultiOauthAuth): ToolAccountInternalRow[] {
  return openai.accounts
    .flatMap((account, accountIndex) => {
      if (typeof account.identityKey !== "string" || account.identityKey.length === 0) {
        return []
      }
      return [{
        accountIndex,
        identityKey: account.identityKey,
        email: account.email,
        plan: account.plan,
        enabled: account.enabled !== false,
        isActive: openai.activeIdentityKey === account.identityKey
      }]
    })
    .map((row, i) => ({
      ...row,
      displayIndex: i + 1
    }))
}

function resolveToolAccount(
  openai: OpenAIMultiOauthAuth,
  index1: number
): AccountRecord & { identityKey: string } {
  if (!Number.isInteger(index1)) throw new Error("Invalid account index")
  if (index1 < 1) throw new Error("Invalid account index")

  const rows = buildToolRows(openai)
  const row = rows[index1 - 1]
  if (!row) throw new Error("Invalid account index")

  const account = openai.accounts[row.accountIndex]
  if (!account?.identityKey) throw new Error("Target account missing identityKey")
  return account as AccountRecord & { identityKey: string }
}

export function listAccountsForTools(openai: OpenAIMultiOauthAuth): ToolAccountRow[] {
  return buildToolRows(openai).map((row) => ({
    displayIndex: row.displayIndex,
    identityKey: row.identityKey,
    email: row.email,
    plan: row.plan,
    enabled: row.enabled,
    isActive: row.isActive
  }))
}

export function switchAccountByIndex(openai: OpenAIMultiOauthAuth, index1: number): OpenAIMultiOauthAuth {
  const target = resolveToolAccount(openai, index1)
  if (target.enabled === false) throw new Error("Target account is disabled")
  return { ...openai, activeIdentityKey: target.identityKey }
}

export function toggleAccountEnabledByIndex(openai: OpenAIMultiOauthAuth, index1: number): OpenAIMultiOauthAuth {
  if (!Number.isInteger(index1)) throw new Error("Invalid account index")
  if (index1 < 1) throw new Error("Invalid account index")

  const rows = buildToolRows(openai)
  const row = rows[index1 - 1]
  if (!row) throw new Error("Invalid account index")

  const idx = row.accountIndex
  if (idx < 0) throw new Error("Target account missing identityKey")
  const target = openai.accounts[idx]
  if (!target?.identityKey) throw new Error("Target account missing identityKey")

  const nextAccounts = [...openai.accounts]
  nextAccounts[idx] = {
    ...target,
    enabled: target.enabled === false
  }
  return { ...openai, accounts: nextAccounts }
}

export function removeAccountByIndex(openai: OpenAIMultiOauthAuth, index1: number): OpenAIMultiOauthAuth {
  if (!Number.isInteger(index1)) throw new Error("Invalid account index")
  if (index1 < 1) throw new Error("Invalid account index")

  const rows = buildToolRows(openai)
  const row = rows[index1 - 1]
  if (!row) throw new Error("Invalid account index")

  const idx = row.accountIndex
  if (idx < 0) throw new Error("Target account missing identityKey")

  const removed = openai.accounts[idx]
  const accounts = openai.accounts.filter((_, i) => i !== idx)
  let activeIdentityKey = openai.activeIdentityKey

  if (removed?.identityKey && openai.activeIdentityKey === removed.identityKey) {
    const forward = accounts.slice(idx).find((a) => a.enabled !== false && a.identityKey)
    const backward = accounts.slice(0, idx).reverse().find((a) => a.enabled !== false && a.identityKey)
    const fallback = forward ?? backward
    activeIdentityKey = fallback?.identityKey
  }

  return {
    ...openai,
    accounts,
    ...(activeIdentityKey ? { activeIdentityKey } : { activeIdentityKey: undefined })
  }
}
