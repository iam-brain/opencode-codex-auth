import type { AccountRecord, OpenAIMultiOauthAuth } from "./types"

export type ToolAccountRow = {
  displayIndex: number // 1-based, matches tools
  identityKey: string
  email?: string
  plan?: string
  enabled: boolean
  isActive: boolean
}

export function listAccountsForTools(openai: OpenAIMultiOauthAuth): ToolAccountRow[] {
  return openai.accounts
    .filter((a): a is AccountRecord & { identityKey: string } => typeof a.identityKey === "string" && a.identityKey.length > 0)
    .map((a, i) => ({
      displayIndex: i + 1,
      identityKey: a.identityKey,
      email: a.email,
      plan: a.plan,
      enabled: a.enabled !== false,
      isActive: openai.activeIdentityKey === a.identityKey
    }))
}

export function switchAccountByIndex(openai: OpenAIMultiOauthAuth, index1: number): OpenAIMultiOauthAuth {
  if (!Number.isInteger(index1)) throw new Error("Invalid account index")
  const idx = index1 - 1
  if (idx < 0 || idx >= openai.accounts.length) throw new Error("Invalid account index")
  const target = openai.accounts[idx]
  if (!target?.identityKey) throw new Error("Target account missing identityKey")
  return { ...openai, activeIdentityKey: target.identityKey }
}

export function toggleAccountEnabledByIndex(openai: OpenAIMultiOauthAuth, index1: number): OpenAIMultiOauthAuth {
  if (!Number.isInteger(index1)) throw new Error("Invalid account index")
  const idx = index1 - 1
  if (idx < 0 || idx >= openai.accounts.length) throw new Error("Invalid account index")
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
  const idx = index1 - 1
  if (idx < 0 || idx >= openai.accounts.length) throw new Error("Invalid account index")
  const removed = openai.accounts[idx]
  const accounts = openai.accounts.filter((_, i) => i !== idx)
  let activeIdentityKey = openai.activeIdentityKey

  if (removed?.identityKey && openai.activeIdentityKey === removed.identityKey) {
    const fallback = accounts[idx] ?? accounts[accounts.length - 1]
    activeIdentityKey = fallback?.identityKey
  }

  return {
    ...openai,
    accounts,
    ...(activeIdentityKey ? { activeIdentityKey } : { activeIdentityKey: undefined })
  }
}
