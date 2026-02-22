import type { AccountRecord, OpenAIMultiOauthAuth } from "./types.js"

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

function cloneDomain(domain: OpenAIMultiOauthAuth["native"]): OpenAIMultiOauthAuth["native"] {
  if (!domain) return undefined
  return {
    ...domain,
    accounts: [...domain.accounts]
  }
}

function normalizeValue(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ""
}

function normalizeAccountId(value: string | undefined): string {
  return value?.trim() ?? ""
}

function matchesTargetAccount(candidate: AccountRecord, target: AccountRecord): boolean {
  if (candidate.identityKey !== target.identityKey) return false
  if (!target.accountId && !target.email && !target.plan) return true

  return (
    normalizeAccountId(candidate.accountId) === normalizeAccountId(target.accountId) &&
    normalizeValue(candidate.email) === normalizeValue(target.email) &&
    normalizeValue(candidate.plan) === normalizeValue(target.plan)
  )
}

function reconcileActiveIdentityKeyForDomain(domain: OpenAIMultiOauthAuth["native"]): void {
  if (!domain) return
  if (
    domain.activeIdentityKey &&
    domain.accounts.some((account) => account.identityKey === domain.activeIdentityKey && account.enabled !== false)
  ) {
    return
  }

  const fallback = domain.accounts.find((account) => account.enabled !== false && account.identityKey)
  domain.activeIdentityKey = fallback?.identityKey
}

function buildToolRows(openai: OpenAIMultiOauthAuth): ToolAccountInternalRow[] {
  return openai.accounts
    .flatMap((account, accountIndex) => {
      if (typeof account.identityKey !== "string" || account.identityKey.length === 0) {
        return []
      }
      return [
        {
          accountIndex,
          identityKey: account.identityKey,
          email: account.email,
          plan: account.plan,
          enabled: account.enabled !== false,
          isActive: openai.activeIdentityKey === account.identityKey
        }
      ]
    })
    .map((row, i) => ({
      ...row,
      displayIndex: i + 1
    }))
}

function resolveToolAccount(openai: OpenAIMultiOauthAuth, index1: number): AccountRecord & { identityKey: string } {
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

  const nextNative = cloneDomain(openai.native)
  const nextCodex = cloneDomain(openai.codex)
  const domains = [nextNative, nextCodex]
  for (const domain of domains) {
    if (!domain) continue
    const hasEnabledTarget = domain.accounts.some(
      (account) => account.identityKey === target.identityKey && account.enabled !== false
    )
    if (hasEnabledTarget) {
      domain.activeIdentityKey = target.identityKey
    }
  }

  return {
    ...openai,
    activeIdentityKey: target.identityKey,
    ...(nextNative ? { native: nextNative } : {}),
    ...(nextCodex ? { codex: nextCodex } : {})
  }
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
  const toggledEnabled = target.enabled === false

  const nextAccounts = [...openai.accounts]
  nextAccounts[idx] = {
    ...target,
    enabled: toggledEnabled
  }

  const nextNative = cloneDomain(openai.native)
  const nextCodex = cloneDomain(openai.codex)
  const domains = [nextNative, nextCodex]
  for (const domain of domains) {
    if (!domain) continue
    const domainIndex = domain.accounts.findIndex((account) => matchesTargetAccount(account, target))
    if (domainIndex >= 0) {
      const domainTarget = domain.accounts[domainIndex]
      if (domainTarget) {
        domain.accounts[domainIndex] = { ...domainTarget, enabled: toggledEnabled }
      }
    }
    reconcileActiveIdentityKeyForDomain(domain)
  }

  return {
    ...openai,
    accounts: nextAccounts,
    ...(nextNative ? { native: nextNative } : {}),
    ...(nextCodex ? { codex: nextCodex } : {})
  }
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
    const backward = accounts
      .slice(0, idx)
      .reverse()
      .find((a) => a.enabled !== false && a.identityKey)
    const fallback = forward ?? backward
    activeIdentityKey = fallback?.identityKey
  }

  const nextNative = cloneDomain(openai.native)
  const nextCodex = cloneDomain(openai.codex)
  const domains = [nextNative, nextCodex]
  for (const domain of domains) {
    if (!domain || !removed?.identityKey) continue
    const domainIndex = domain.accounts.findIndex((account) => matchesTargetAccount(account, removed))
    if (domainIndex >= 0) {
      domain.accounts = domain.accounts.filter((_, i) => i !== domainIndex)
    }
    reconcileActiveIdentityKeyForDomain(domain)
  }

  return {
    ...openai,
    accounts,
    ...(activeIdentityKey ? { activeIdentityKey } : { activeIdentityKey: undefined }),
    ...(nextNative ? { native: nextNative } : {}),
    ...(nextCodex ? { codex: nextCodex } : {})
  }
}
