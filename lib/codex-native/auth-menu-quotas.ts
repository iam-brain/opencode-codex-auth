import { extractEmailFromClaims, extractPlanFromClaims, parseJwtClaims } from "../claims"
import { loadSnapshots, saveSnapshots } from "../codex-status-storage"
import { fetchQuotaSnapshotFromBackend } from "../codex-quota-fetch"
import type { CodexSpoofMode } from "../config"
import type { Logger } from "../logger"
import { defaultSnapshotsPath } from "../paths"
import type { OpenAIAuthMode } from "../types"
import type { CodexRateLimitSnapshot } from "../types"
import { resolveRequestUserAgent } from "./client-identity"
import { resolveCodexOriginator } from "./originator"
import { hydrateAccountIdentityFromAccessClaims } from "./accounts"
import { extractAccountId, refreshAccessToken } from "./oauth-utils"
import { ensureOpenAIOAuthDomain, listOpenAIOAuthDomains, loadAuthStorage, saveAuthStorage } from "../storage"

const AUTH_MENU_QUOTA_SNAPSHOT_TTL_MS = 60_000
const AUTH_MENU_QUOTA_FAILURE_COOLDOWN_MS = 30_000
const AUTH_MENU_QUOTA_FETCH_TIMEOUT_MS = 2500
const AUTH_MENU_QUOTA_REFRESH_LEASE_MS = 30_000
const AUTH_MENU_QUOTA_FETCH_CONCURRENCY = 4

type RefreshClaim = {
  mode: OpenAIAuthMode
  identityKey: string
  refreshToken: string
  leaseUntil: number
}

async function claimRefreshForQuotaSnapshot(input: {
  mode: OpenAIAuthMode
  identityKey: string
}): Promise<RefreshClaim | undefined> {
  let claim: RefreshClaim | undefined
  await saveAuthStorage(undefined, (authFile) => {
    const domain = ensureOpenAIOAuthDomain(authFile, input.mode)
    const target = domain.accounts.find((account) => account.identityKey === input.identityKey)
    if (!target || target.enabled === false || !target.refresh || !target.identityKey) return authFile
    const now = Date.now()
    if (typeof target.refreshLeaseUntil === "number" && target.refreshLeaseUntil > now) return authFile
    const leaseUntil = now + AUTH_MENU_QUOTA_REFRESH_LEASE_MS
    target.refreshLeaseUntil = leaseUntil
    claim = {
      mode: input.mode,
      identityKey: target.identityKey,
      refreshToken: target.refresh,
      leaseUntil
    }
    return authFile
  })
  return claim
}

async function persistRefreshedTokensForQuotaSnapshot(input: {
  claim: RefreshClaim
  tokens: Awaited<ReturnType<typeof refreshAccessToken>>
  mirror: {
    refresh?: string
    access?: string
    expires?: number
    accountId?: string
    email?: string
    plan?: string
    identityKey?: string
  }
}): Promise<string | undefined> {
  let nextAccessToken: string | undefined
  await saveAuthStorage(undefined, (authFile) => {
    const domain = ensureOpenAIOAuthDomain(authFile, input.claim.mode)
    const target = domain.accounts.find((account) => account.identityKey === input.claim.identityKey)
    if (!target || target.enabled === false) return authFile

    const now = Date.now()
    if (
      typeof target.refreshLeaseUntil !== "number" ||
      target.refreshLeaseUntil <= now ||
      target.refreshLeaseUntil !== input.claim.leaseUntil
    ) {
      delete target.refreshLeaseUntil
      return authFile
    }

    const claims = parseJwtClaims(input.tokens.id_token ?? input.tokens.access_token)
    target.refresh = input.tokens.refresh_token
    target.access = input.tokens.access_token
    target.expires = now + (input.tokens.expires_in ?? 3600) * 1000
    target.accountId = extractAccountId(input.tokens) || target.accountId
    target.email = extractEmailFromClaims(claims) || target.email
    target.plan = extractPlanFromClaims(claims) || target.plan
    target.lastUsed = now
    hydrateAccountIdentityFromAccessClaims(target)
    delete target.refreshLeaseUntil
    delete target.cooldownUntil

    input.mirror.refresh = target.refresh
    input.mirror.access = target.access
    input.mirror.expires = target.expires
    input.mirror.accountId = target.accountId
    input.mirror.email = target.email
    input.mirror.plan = target.plan
    input.mirror.identityKey = target.identityKey
    nextAccessToken = target.access
    return authFile
  })
  return nextAccessToken
}

async function releaseFailedRefreshClaimForQuotaSnapshot(input: { claim: RefreshClaim; now: number }): Promise<void> {
  await saveAuthStorage(undefined, (authFile) => {
    const domain = ensureOpenAIOAuthDomain(authFile, input.claim.mode)
    const target = domain.accounts.find((account) => account.identityKey === input.claim.identityKey)
    if (!target) return authFile
    if (target.refreshLeaseUntil !== input.claim.leaseUntil) return authFile
    delete target.refreshLeaseUntil
    if (target.enabled !== false) {
      target.cooldownUntil = input.now + AUTH_MENU_QUOTA_FAILURE_COOLDOWN_MS
    }
    return authFile
  })
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return
  const concurrency = Math.max(1, Math.min(limit, items.length))
  let index = 0

  const runner = async () => {
    while (true) {
      const currentIndex = index
      index += 1
      if (currentIndex >= items.length) return
      const item = items[currentIndex]
      if (item !== undefined) {
        await worker(item)
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runner()))
}

export type RefreshQuotaSnapshotsInput = {
  spoofMode: CodexSpoofMode
  log?: Logger
  cooldownByIdentity: Map<string, number>
}

type RefreshCandidate = {
  mode: OpenAIAuthMode
  identityKey: string
  mirror: {
    refresh?: string
    access?: string
    expires?: number
    accountId?: string
    email?: string
    plan?: string
    identityKey?: string
  }
}

export async function refreshQuotaSnapshotsForAuthMenu(input: RefreshQuotaSnapshotsInput): Promise<void> {
  const auth = await loadAuthStorage()
  const snapshotPath = defaultSnapshotsPath()
  const existingSnapshots: Record<string, { updatedAt?: number }> = await loadSnapshots(snapshotPath).catch(() => ({}))
  const snapshotUpdates: Record<string, CodexRateLimitSnapshot> = {}
  const fetchRequests: Array<{ identityKey: string; accessToken: string; accountId?: string }> = []
  const refreshCandidates: RefreshCandidate[] = []
  const userAgent = resolveRequestUserAgent(input.spoofMode, resolveCodexOriginator(input.spoofMode))

  for (const { mode, domain } of listOpenAIOAuthDomains(auth)) {
    for (let index = 0; index < domain.accounts.length; index += 1) {
      const account = domain.accounts[index]
      if (!account || account.enabled === false) continue

      hydrateAccountIdentityFromAccessClaims(account)
      const identityKey = account.identityKey
      const now = Date.now()
      if (identityKey) {
        const cooldownUntil = input.cooldownByIdentity.get(identityKey)
        if (typeof cooldownUntil === "number" && cooldownUntil > now) continue
        const existing = existingSnapshots[identityKey]
        if (
          existing &&
          typeof existing.updatedAt === "number" &&
          Number.isFinite(existing.updatedAt) &&
          now - existing.updatedAt < AUTH_MENU_QUOTA_SNAPSHOT_TTL_MS
        ) {
          continue
        }
      }

      let accessToken = typeof account.access === "string" && account.access.length > 0 ? account.access : undefined
      const expired = typeof account.expires === "number" && Number.isFinite(account.expires) && account.expires <= now

      if ((!accessToken || expired) && account.refresh) {
        if (identityKey) {
          refreshCandidates.push({
            mode,
            identityKey,
            mirror: account
          })
        }
        continue
      }

      if (accessToken && account.identityKey) {
        fetchRequests.push({
          identityKey: account.identityKey,
          accessToken,
          accountId: account.accountId
        })
      }
    }
  }

  await runWithConcurrency(refreshCandidates, AUTH_MENU_QUOTA_FETCH_CONCURRENCY, async (candidate) => {
    let refreshClaim: RefreshClaim | undefined
    try {
      refreshClaim = await claimRefreshForQuotaSnapshot({ mode: candidate.mode, identityKey: candidate.identityKey })
      if (!refreshClaim) return

      const tokens = await refreshAccessToken(refreshClaim.refreshToken)
      const persisted = await persistRefreshedTokensForQuotaSnapshot({
        claim: refreshClaim,
        tokens,
        mirror: candidate.mirror
      })
      if (!persisted || !candidate.mirror.identityKey) return

      fetchRequests.push({
        identityKey: candidate.mirror.identityKey,
        accessToken: persisted,
        accountId: candidate.mirror.accountId
      })
    } catch (error) {
      input.cooldownByIdentity.set(candidate.identityKey, Date.now() + AUTH_MENU_QUOTA_FAILURE_COOLDOWN_MS)
      if (refreshClaim) {
        await releaseFailedRefreshClaimForQuotaSnapshot({ claim: refreshClaim, now: Date.now() })
      }
      input.log?.debug("quota check refresh failed", {
        identityKey: candidate.identityKey,
        mode: candidate.mode,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })

  await runWithConcurrency(fetchRequests, AUTH_MENU_QUOTA_FETCH_CONCURRENCY, async (request) => {
    const snapshot = await fetchQuotaSnapshotFromBackend({
      accessToken: request.accessToken,
      accountId: request.accountId,
      now: Date.now(),
      modelFamily: "gpt-5.3-codex",
      userAgent,
      log: input.log,
      timeoutMs: AUTH_MENU_QUOTA_FETCH_TIMEOUT_MS
    })
    if (!snapshot) {
      input.cooldownByIdentity.set(request.identityKey, Date.now() + AUTH_MENU_QUOTA_FAILURE_COOLDOWN_MS)
      return
    }
    input.cooldownByIdentity.delete(request.identityKey)
    snapshotUpdates[request.identityKey] = snapshot
  })

  if (Object.keys(snapshotUpdates).length === 0) return

  await saveSnapshots(snapshotPath, (current) => ({
    ...current,
    ...snapshotUpdates
  }))
}
