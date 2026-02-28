import type { AccountRecord, OpenAIMultiOauthAuth } from "./types.js"
import {
  assignDeterministicFallbackIdentityKey,
  buildLegacyIdentityFingerprint,
  ensureIdentityKey,
  normalizeEmail,
  normalizePlan
} from "./identity.js"

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

function normalizeIdentityFields(account: AccountRecord): void {
  if (account.accountId) {
    const trimmed = account.accountId.trim()
    account.accountId = trimmed || undefined
  }
  account.email = normalizeEmail(account.email)
  account.plan = normalizePlan(account.plan)
}

function hydrateAccounts(accounts: AccountRecord[]): AccountRecord[] {
  const fallbackIdentityCounts = new Map<string, number>()
  return accounts.map((account) => {
    const next: AccountRecord = { ...account }
    normalizeIdentityFields(next)
    ensureIdentityKey(next)
    if (next.identityKey) {
      return next
    }

    const fingerprint = buildLegacyIdentityFingerprint(next)
    const occurrence = fallbackIdentityCounts.get(fingerprint) ?? 0
    fallbackIdentityCounts.set(fingerprint, occurrence + 1)
    assignDeterministicFallbackIdentityKey(next, occurrence)
    return next
  })
}

function hydrateOpenAIForTooling(openai: OpenAIMultiOauthAuth): OpenAIMultiOauthAuth {
  const nextNative = openai.native
    ? {
        ...openai.native,
        accounts: hydrateAccounts(openai.native.accounts)
      }
    : undefined
  const nextCodex = openai.codex
    ? {
        ...openai.codex,
        accounts: hydrateAccounts(openai.codex.accounts)
      }
    : undefined

  const hydrated: OpenAIMultiOauthAuth = {
    ...openai,
    accounts: hydrateAccounts(openai.accounts),
    ...(nextNative ? { native: nextNative } : {}),
    ...(nextCodex ? { codex: nextCodex } : {})
  }

  reconcileActiveIdentityKeyForDomain(hydrated.native)
  reconcileActiveIdentityKeyForDomain(hydrated.codex)

  if (
    hydrated.activeIdentityKey &&
    hydrated.accounts.some((account) => account.identityKey === hydrated.activeIdentityKey && account.enabled !== false)
  ) {
    return hydrated
  }

  hydrated.activeIdentityKey = hydrated.accounts.find((account) => account.enabled !== false && account.identityKey)?.identityKey
  return hydrated
}

function normalizeValue(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ""
}

function normalizeAccountId(value: string | undefined): string {
  return value?.trim() ?? ""
}

function hasStrictTuple(account: AccountRecord): boolean {
  return Boolean(
    normalizeAccountId(account.accountId) &&
      normalizeValue(account.email) &&
      normalizeValue(account.plan)
  )
}

function findUniqueDomainMatchIndex(domainAccounts: AccountRecord[], target: AccountRecord): number {
  if (target.identityKey) {
    const identityMatches = domainAccounts
      .map((account, index) => ({ account, index }))
      .filter(({ account }) => account.identityKey === target.identityKey)
    if (identityMatches.length === 1) return identityMatches[0]!.index
    if (identityMatches.length > 1) return -1
  }

  if (hasStrictTuple(target)) {
    const tupleMatches = domainAccounts
      .map((account, index) => ({ account, index }))
      .filter(({ account }) => {
        return (
          normalizeAccountId(account.accountId) === normalizeAccountId(target.accountId) &&
          normalizeValue(account.email) === normalizeValue(target.email) &&
          normalizeValue(account.plan) === normalizeValue(target.plan)
        )
      })
    if (tupleMatches.length === 1) return tupleMatches[0]!.index
    return -1
  }

  const targetRefresh = target.refresh?.trim()
  if (!targetRefresh) return -1
  const refreshMatches = domainAccounts
    .map((account, index) => ({ account, index }))
    .filter(({ account }) => account.refresh?.trim() === targetRefresh)
  if (refreshMatches.length === 1) return refreshMatches[0]!.index
  return -1
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
  const hydrated = hydrateOpenAIForTooling(openai)
  return buildToolRows(hydrated).map((row) => ({
    displayIndex: row.displayIndex,
    identityKey: row.identityKey,
    email: row.email,
    plan: row.plan,
    enabled: row.enabled,
    isActive: row.isActive
  }))
}

export function switchAccountByIndex(openai: OpenAIMultiOauthAuth, index1: number): OpenAIMultiOauthAuth {
  const hydrated = hydrateOpenAIForTooling(openai)
  const target = resolveToolAccount(hydrated, index1)
  if (target.enabled === false) throw new Error("Target account is disabled")

  const nextNative = cloneDomain(hydrated.native)
  const nextCodex = cloneDomain(hydrated.codex)
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
    ...hydrated,
    activeIdentityKey: target.identityKey,
    ...(nextNative ? { native: nextNative } : {}),
    ...(nextCodex ? { codex: nextCodex } : {})
  }
}

export function toggleAccountEnabledByIndex(openai: OpenAIMultiOauthAuth, index1: number): OpenAIMultiOauthAuth {
  const hydrated = hydrateOpenAIForTooling(openai)
  if (!Number.isInteger(index1)) throw new Error("Invalid account index")
  if (index1 < 1) throw new Error("Invalid account index")

  const rows = buildToolRows(hydrated)
  const row = rows[index1 - 1]
  if (!row) throw new Error("Invalid account index")

  const idx = row.accountIndex
  if (idx < 0) throw new Error("Target account missing identityKey")
  const target = hydrated.accounts[idx]
  if (!target?.identityKey) throw new Error("Target account missing identityKey")
  const toggledEnabled = target.enabled === false

  const nextAccounts = [...hydrated.accounts]
  nextAccounts[idx] = {
    ...target,
    enabled: toggledEnabled
  }

  const nextNative = cloneDomain(hydrated.native)
  const nextCodex = cloneDomain(hydrated.codex)
  const domains = [nextNative, nextCodex]
  for (const domain of domains) {
    if (!domain) continue
    const domainIndex = findUniqueDomainMatchIndex(domain.accounts, target)
    if (domainIndex >= 0) {
      const domainTarget = domain.accounts[domainIndex]
      if (domainTarget) {
        domain.accounts[domainIndex] = { ...domainTarget, enabled: toggledEnabled }
      }
    }
    reconcileActiveIdentityKeyForDomain(domain)
  }

  return {
    ...hydrated,
    accounts: nextAccounts,
    ...(nextNative ? { native: nextNative } : {}),
    ...(nextCodex ? { codex: nextCodex } : {})
  }
}

export function removeAccountByIndex(openai: OpenAIMultiOauthAuth, index1: number): OpenAIMultiOauthAuth {
  const hydrated = hydrateOpenAIForTooling(openai)
  if (!Number.isInteger(index1)) throw new Error("Invalid account index")
  if (index1 < 1) throw new Error("Invalid account index")

  const rows = buildToolRows(hydrated)
  const row = rows[index1 - 1]
  if (!row) throw new Error("Invalid account index")

  const idx = row.accountIndex
  if (idx < 0) throw new Error("Target account missing identityKey")

  const removed = hydrated.accounts[idx]
  const accounts = hydrated.accounts.filter((_, i) => i !== idx)
  let activeIdentityKey = hydrated.activeIdentityKey

  if (removed?.identityKey && hydrated.activeIdentityKey === removed.identityKey) {
    const forward = accounts.slice(idx).find((a) => a.enabled !== false && a.identityKey)
    const backward = accounts
      .slice(0, idx)
      .reverse()
      .find((a) => a.enabled !== false && a.identityKey)
    const fallback = forward ?? backward
    activeIdentityKey = fallback?.identityKey
  }

  const nextNative = cloneDomain(hydrated.native)
  const nextCodex = cloneDomain(hydrated.codex)
  const domains = [nextNative, nextCodex]
  for (const domain of domains) {
    if (!domain || !removed?.identityKey) continue
    const domainIndex = findUniqueDomainMatchIndex(domain.accounts, removed)
    if (domainIndex >= 0) {
      domain.accounts = domain.accounts.filter((_, i) => i !== domainIndex)
    }
    reconcileActiveIdentityKeyForDomain(domain)
  }

  return {
    ...hydrated,
    accounts,
    ...(activeIdentityKey ? { activeIdentityKey } : { activeIdentityKey: undefined }),
    ...(nextNative ? { native: nextNative } : {}),
    ...(nextCodex ? { codex: nextCodex } : {})
  }
}
