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

export function buildIdentityKey(input: {
  accountId?: string
  email?: string
  plan?: string
}): string | undefined {
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
