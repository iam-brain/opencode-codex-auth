import type { QuotaThresholdTrackerState } from "../quota-threshold-alerts.js"

export type CatalogSyncState = {
  lastAttemptAt: number
  lastFailureAt: number
  inFlight: Promise<void> | null
}

export const QUOTA_STATE_MAX_ENTRIES = 512
export const QUOTA_REFRESH_TTL_MS = 60_000
export const QUOTA_REFRESH_FAILURE_RETRY_MS = 10_000
export const QUOTA_FETCH_TIMEOUT_MS = 3000
export const QUOTA_EXHAUSTED_FALLBACK_COOLDOWN_MS = 5 * 60 * 1000
export const CATALOG_REFRESH_TTL_MS = 60_000
export const CATALOG_REFRESH_FAILURE_RETRY_MS = 10_000
const CATALOG_SCOPE_MAX_ENTRIES = 256
const CATALOG_SCOPE_STALE_TTL_MS = 6 * 60 * 60 * 1000

const STRIPPED_OUTBOUND_HEADER_NAMES = new Set(["cookie", "set-cookie", "proxy-authorization", "host", "forwarded"])

function normalizeCatalogScopePart(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

export function resolveCatalogScopeKey(auth: {
  accountId?: string
  identityKey?: string
  email?: string
  plan?: string
  selectionTrace?: { attemptKey?: string }
}): string {
  const identityKey = normalizeCatalogScopePart(auth.identityKey)
  if (identityKey) return `identity:${identityKey}`

  const accountId = normalizeCatalogScopePart(auth.accountId)
  const email = normalizeCatalogScopePart(auth.email)?.toLowerCase()
  const plan = normalizeCatalogScopePart(auth.plan)?.toLowerCase()
  if (accountId && email && plan) return `tuple:${accountId}|${email}|${plan}`
  if (accountId) return `account:${accountId}`

  const attemptKey = normalizeCatalogScopePart(auth.selectionTrace?.attemptKey)
  if (attemptKey) return `attempt:${attemptKey}`

  return "anonymous"
}

export function pruneCatalogSyncState(catalogSyncByScope: Map<string, CatalogSyncState>, now: number): void {
  const staleCutoff = now - CATALOG_SCOPE_STALE_TTL_MS
  if (catalogSyncByScope.size > 0) {
    for (const [scopeKey, state] of catalogSyncByScope) {
      if (state.inFlight === null && state.lastAttemptAt < staleCutoff) {
        catalogSyncByScope.delete(scopeKey)
      }
    }
  }

  if (catalogSyncByScope.size <= CATALOG_SCOPE_MAX_ENTRIES) return

  for (const [scopeKey, state] of catalogSyncByScope) {
    if (catalogSyncByScope.size <= CATALOG_SCOPE_MAX_ENTRIES) break
    if (state.inFlight !== null) continue
    catalogSyncByScope.delete(scopeKey)
  }
}

export function getCatalogSyncState(
  catalogSyncByScope: Map<string, CatalogSyncState>,
  scopeKey: string
): CatalogSyncState {
  pruneCatalogSyncState(catalogSyncByScope, Date.now())
  const existing = catalogSyncByScope.get(scopeKey)
  if (existing) {
    catalogSyncByScope.delete(scopeKey)
    catalogSyncByScope.set(scopeKey, existing)
    return existing
  }
  const next = { lastAttemptAt: 0, lastFailureAt: 0, inFlight: null as Promise<void> | null }
  catalogSyncByScope.set(scopeKey, next)
  return next
}

export function pruneQuotaState(
  quotaRefreshAtByIdentity: Map<string, number>,
  quotaTrackerByIdentity: Map<string, QuotaThresholdTrackerState>,
  now: number
): void {
  if (quotaRefreshAtByIdentity.size <= QUOTA_STATE_MAX_ENTRIES) return

  const staleKeys: string[] = []
  for (const [identityKey, nextRefreshAt] of quotaRefreshAtByIdentity) {
    if (nextRefreshAt < now - QUOTA_REFRESH_TTL_MS) {
      staleKeys.push(identityKey)
    }
  }
  for (const identityKey of staleKeys) {
    quotaRefreshAtByIdentity.delete(identityKey)
    quotaTrackerByIdentity.delete(identityKey)
    if (quotaRefreshAtByIdentity.size <= QUOTA_STATE_MAX_ENTRIES) return
  }

  while (quotaRefreshAtByIdentity.size > QUOTA_STATE_MAX_ENTRIES) {
    const oldest = quotaRefreshAtByIdentity.keys().next().value
    if (!oldest) break
    quotaRefreshAtByIdentity.delete(oldest)
    quotaTrackerByIdentity.delete(oldest)
  }
}

export function stripUnsafeForwardedHeaders(headers: Headers): void {
  for (const name of [...headers.keys()]) {
    const lower = name.trim().toLowerCase()
    if (STRIPPED_OUTBOUND_HEADER_NAMES.has(lower) || lower.startsWith("x-forwarded-")) {
      headers.delete(name)
    }
  }
}
