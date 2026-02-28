import type { AccountRecord } from "./types.js"

export function normalizeEmail(email?: string): string | undefined {
  if (!email) return undefined
  const trimmed = email.trim()
  if (!trimmed) return undefined
  return trimmed.toLowerCase()
}

export function normalizePlan(plan?: string): string | undefined {
  if (!plan) return undefined
  const trimmed = plan.trim()
  if (!trimmed) return undefined
  return trimmed.toLowerCase()
}

export function buildIdentityKey(input: { accountId?: string; email?: string; plan?: string }): string | undefined {
  const accountId = input.accountId?.trim()
  const email = normalizeEmail(input.email)
  const plan = normalizePlan(input.plan)
  if (!accountId || !email || !plan) return undefined
  return `${accountId}|${email}|${plan}`
}

function normalizeLegacyIdentitySegment(value?: string): string {
  const trimmed = value?.trim()
  if (!trimmed) return "_"
  return encodeURIComponent(trimmed)
}

export function buildLegacyIdentityFingerprint(input: { accountId?: string; email?: string; plan?: string }): string {
  const accountId = normalizeLegacyIdentitySegment(input.accountId)
  const email = normalizeLegacyIdentitySegment(normalizeEmail(input.email))
  const plan = normalizeLegacyIdentitySegment(normalizePlan(input.plan))
  return `legacy|${accountId}|${email}|${plan}`
}

export function assignDeterministicFallbackIdentityKey(account: AccountRecord, occurrence = 0): AccountRecord {
  if (account.identityKey) return account
  const base = buildLegacyIdentityFingerprint(account)
  account.identityKey = occurrence > 0 ? `${base}|dup:${occurrence + 1}` : base
  return account
}

export function ensureIdentityKey(account: AccountRecord): AccountRecord {
  if (!account.identityKey) {
    account.identityKey = buildIdentityKey(account)
  }
  return account
}

function isCanonicalIdentityKey(value: string): boolean {
  const parts = value.split("|")
  if (parts.length !== 3) return false
  return parts.every((part) => part.trim().length > 0)
}

export function synchronizeIdentityKey(account: AccountRecord): AccountRecord {
  const canonical = buildIdentityKey(account)
  if (!canonical) return account

  const current = account.identityKey
  if (!current) {
    account.identityKey = canonical
    return account
  }
  if (current === canonical) return account

  // Migrate strict tuple keys and legacy fallback keys, but avoid rewriting
  // arbitrary non-canonical identifiers that may still be in active use.
  if (current.startsWith("legacy|") || isCanonicalIdentityKey(current)) {
    account.identityKey = canonical
  }
  return account
}
