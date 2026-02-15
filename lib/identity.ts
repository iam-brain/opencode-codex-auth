import type { AccountRecord } from "./types"

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

/**
 * Ensure `account.identityKey` matches the canonical form derived from
 * accountId, email, and plan. If the existing key is in canonical format
 * but differs (e.g., email or plan changed), it is silently replaced.
 * Non-canonical keys (e.g., legacy or manually assigned) are preserved.
 */
export function synchronizeIdentityKey(account: AccountRecord): AccountRecord {
  const canonical = buildIdentityKey(account)
  if (!canonical) return account

  if (!account.identityKey) {
    account.identityKey = canonical
    return account
  }

  if (account.identityKey === canonical) {
    return account
  }

  if (isCanonicalIdentityKey(account.identityKey)) {
    account.identityKey = canonical
  }
  return account
}
