import { extractAccountIdFromClaims, extractEmailFromClaims, extractPlanFromClaims, parseJwtClaims } from "../claims"
import { normalizeAccountAuthTypes } from "../account-auth-types"
import { buildIdentityKey, normalizeEmail, normalizePlan, synchronizeIdentityKey } from "../identity"
import type { AccountAuthType, AccountRecord, OpenAIAuthMode, OpenAIOAuthDomain } from "../types"
import type { AccountInfo } from "../ui/auth-menu"

export function upsertAccount(openai: OpenAIOAuthDomain, incoming: AccountRecord): AccountRecord {
  const normalizedEmail = normalizeEmail(incoming.email)
  const normalizedPlan = normalizePlan(incoming.plan)
  const normalizedAccountId = incoming.accountId?.trim()
  const strictIdentityKey = buildIdentityKey({
    accountId: normalizedAccountId,
    email: normalizedEmail,
    plan: normalizedPlan
  })
  const strictMatch = strictIdentityKey
    ? openai.accounts.find((existing) => {
        const existingAccountId = existing.accountId?.trim()
        const existingEmail = normalizeEmail(existing.email)
        const existingPlan = normalizePlan(existing.plan)
        return (
          existingAccountId === normalizedAccountId &&
          existingEmail === normalizedEmail &&
          existingPlan === normalizedPlan
        )
      })
    : undefined

  const refreshFallbackMatch =
    strictMatch || !incoming.refresh
      ? undefined
      : openai.accounts.find((existing) => existing.refresh === incoming.refresh)

  const match = strictMatch ?? refreshFallbackMatch
  const matchedByRefreshFallback = refreshFallbackMatch !== undefined && strictMatch === undefined
  const requiresInsert =
    matchedByRefreshFallback &&
    strictIdentityKey !== undefined &&
    match?.identityKey !== undefined &&
    match.identityKey !== strictIdentityKey

  const target = !match || requiresInsert ? ({} as AccountRecord) : match
  if (!match || requiresInsert) {
    openai.accounts.push(target)
  }

  if (!matchedByRefreshFallback || requiresInsert) {
    if (normalizedAccountId) target.accountId = normalizedAccountId
    if (normalizedEmail) target.email = normalizedEmail
    if (normalizedPlan) target.plan = normalizedPlan
  }

  if (incoming.enabled !== undefined) target.enabled = incoming.enabled
  if (incoming.refresh) target.refresh = incoming.refresh
  if (incoming.access) target.access = incoming.access
  if (incoming.expires !== undefined) target.expires = incoming.expires
  if (incoming.lastUsed !== undefined) target.lastUsed = incoming.lastUsed
  target.authTypes = normalizeAccountAuthTypes(incoming.authTypes ?? match?.authTypes)

  synchronizeIdentityKey(target)
  if (!target.identityKey && strictIdentityKey) target.identityKey = strictIdentityKey

  return target
}

export function formatAccountLabel(
  account: { email?: string; plan?: string; accountId?: string } | undefined,
  index: number
): string {
  const email = account?.email?.trim()
  const plan = account?.plan?.trim()
  const accountId = account?.accountId?.trim()
  const idSuffix = accountId ? (accountId.length > 6 ? accountId.slice(-6) : accountId) : null

  if (email && plan) return `${email} (${plan})`
  if (email) return email
  if (idSuffix) return `id:${idSuffix}`
  return `Account ${index + 1}`
}

function hasActiveCooldown(account: AccountRecord, now: number): boolean {
  return (
    typeof account.cooldownUntil === "number" && Number.isFinite(account.cooldownUntil) && account.cooldownUntil > now
  )
}

export function ensureAccountAuthTypes(account: AccountRecord): AccountAuthType[] {
  const normalized = normalizeAccountAuthTypes(account.authTypes)
  account.authTypes = normalized
  return normalized
}

export function reconcileActiveIdentityKey(openai: OpenAIOAuthDomain): void {
  if (
    openai.activeIdentityKey &&
    openai.accounts.some((account) => account.identityKey === openai.activeIdentityKey && account.enabled !== false)
  ) {
    return
  }

  const fallback = openai.accounts.find((account) => account.enabled !== false && account.identityKey)
  openai.activeIdentityKey = fallback?.identityKey
}

export function findDomainAccountIndex(domain: OpenAIOAuthDomain, account: AccountInfo): number {
  if (account.identityKey) {
    const byIdentity = domain.accounts.findIndex((entry) => entry.identityKey === account.identityKey)
    if (byIdentity >= 0) return byIdentity
  }
  return domain.accounts.findIndex((entry) => {
    const sameId = (entry.accountId?.trim() ?? "") === (account.accountId?.trim() ?? "")
    const sameEmail = normalizeEmail(entry.email) === normalizeEmail(account.email)
    const samePlan = normalizePlan(entry.plan) === normalizePlan(account.plan)
    return sameId && sameEmail && samePlan
  })
}

export function buildAuthMenuAccounts(input: {
  native?: OpenAIOAuthDomain
  codex?: OpenAIOAuthDomain
  activeMode: OpenAIAuthMode
}): AccountInfo[] {
  const now = Date.now()
  const rows = new Map<string, AccountInfo>()

  const mergeFromDomain = (authMode: OpenAIAuthMode, domain?: OpenAIOAuthDomain) => {
    if (!domain) return
    for (const account of domain.accounts) {
      ensureAccountAuthTypes(account)
      const identity =
        account.identityKey ??
        buildIdentityKey({
          accountId: account.accountId,
          email: normalizeEmail(account.email),
          plan: normalizePlan(account.plan)
        }) ??
        `${authMode}:${account.accountId ?? account.email ?? account.plan ?? "unknown"}`

      const existing = rows.get(identity)
      const currentStatus: AccountInfo["status"] = hasActiveCooldown(account, now)
        ? "rate-limited"
        : typeof account.expires === "number" && Number.isFinite(account.expires) && account.expires <= now
          ? "expired"
          : "unknown"

      if (!existing) {
        const isCurrentAccount =
          authMode === input.activeMode &&
          Boolean(domain.activeIdentityKey && account.identityKey === domain.activeIdentityKey)
        rows.set(identity, {
          identityKey: account.identityKey,
          index: rows.size,
          accountId: account.accountId,
          email: account.email,
          plan: account.plan,
          authTypes: [authMode],
          lastUsed: account.lastUsed,
          enabled: account.enabled,
          status: isCurrentAccount ? "active" : currentStatus,
          isCurrentAccount
        })
        continue
      }

      existing.authTypes = normalizeAccountAuthTypes([...(existing.authTypes ?? []), authMode])
      if (typeof account.lastUsed === "number" && (!existing.lastUsed || account.lastUsed > existing.lastUsed)) {
        existing.lastUsed = account.lastUsed
      }
      if (existing.enabled === false && account.enabled !== false) {
        existing.enabled = true
      }
      if (existing.status !== "rate-limited" && currentStatus === "rate-limited") {
        existing.status = "rate-limited"
      } else if (existing.status !== "rate-limited" && existing.status !== "expired" && currentStatus === "expired") {
        existing.status = "expired"
      }
      const isCurrentAccount =
        authMode === input.activeMode &&
        Boolean(domain.activeIdentityKey && account.identityKey === domain.activeIdentityKey)
      if (isCurrentAccount) {
        existing.isCurrentAccount = true
        existing.status = "active"
      }
    }
  }

  mergeFromDomain("native", input.native)
  mergeFromDomain("codex", input.codex)
  return Array.from(rows.values()).map((row, index) => ({ ...row, index }))
}

export function hydrateAccountIdentityFromAccessClaims(account: AccountRecord): void {
  const claims =
    typeof account.access === "string" && account.access.length > 0 ? parseJwtClaims(account.access) : undefined
  if (!account.accountId) account.accountId = extractAccountIdFromClaims(claims)
  if (!account.email) account.email = extractEmailFromClaims(claims)
  if (!account.plan) account.plan = extractPlanFromClaims(claims)
  account.email = normalizeEmail(account.email)
  account.plan = normalizePlan(account.plan)
  if (account.accountId) account.accountId = account.accountId.trim()
  ensureAccountAuthTypes(account)
  synchronizeIdentityKey(account)
}
