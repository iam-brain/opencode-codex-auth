import { extractEmailFromClaims, extractPlanFromClaims, parseJwtClaims } from "../claims"
import { loadSnapshots, saveSnapshots } from "../codex-status-storage"
import { fetchQuotaSnapshotFromBackend } from "../codex-quota-fetch"
import type { CodexSpoofMode } from "../config"
import type { Logger } from "../logger"
import { defaultSnapshotsPath } from "../paths"
import type { CodexRateLimitSnapshot } from "../types"
import { resolveRequestUserAgent } from "./client-identity"
import { resolveCodexOriginator } from "./originator"
import { hydrateAccountIdentityFromAccessClaims } from "./accounts"
import { extractAccountId, refreshAccessToken } from "./oauth-utils"
import { ensureOpenAIOAuthDomain, listOpenAIOAuthDomains, loadAuthStorage, saveAuthStorage } from "../storage"

const AUTH_MENU_QUOTA_SNAPSHOT_TTL_MS = 60_000
const AUTH_MENU_QUOTA_FAILURE_COOLDOWN_MS = 30_000
const AUTH_MENU_QUOTA_FETCH_TIMEOUT_MS = 5000

export type RefreshQuotaSnapshotsInput = {
  spoofMode: CodexSpoofMode
  log?: Logger
  cooldownByIdentity: Map<string, number>
}

export async function refreshQuotaSnapshotsForAuthMenu(input: RefreshQuotaSnapshotsInput): Promise<void> {
  const auth = await loadAuthStorage()
  const snapshotPath = defaultSnapshotsPath()
  const existingSnapshots: Record<string, { updatedAt?: number }> = await loadSnapshots(snapshotPath).catch(() => ({}))
  const snapshotUpdates: Record<string, CodexRateLimitSnapshot> = {}

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
        try {
          await saveAuthStorage(undefined, async (authFile) => {
            const current = ensureOpenAIOAuthDomain(authFile, mode)
            const target = current.accounts[index]
            if (!target || target.enabled === false || !target.refresh) return authFile

            const tokens = await refreshAccessToken(target.refresh)
            const refreshedAt = Date.now()
            const claims = parseJwtClaims(tokens.id_token ?? tokens.access_token)

            target.refresh = tokens.refresh_token
            target.access = tokens.access_token
            target.expires = refreshedAt + (tokens.expires_in ?? 3600) * 1000
            target.accountId = extractAccountId(tokens) || target.accountId
            target.email = extractEmailFromClaims(claims) || target.email
            target.plan = extractPlanFromClaims(claims) || target.plan
            target.lastUsed = refreshedAt
            hydrateAccountIdentityFromAccessClaims(target)

            account.refresh = target.refresh
            account.access = target.access
            account.expires = target.expires
            account.accountId = target.accountId
            account.email = target.email
            account.plan = target.plan
            account.identityKey = target.identityKey
            accessToken = target.access

            return authFile
          })
        } catch (error) {
          if (identityKey) {
            input.cooldownByIdentity.set(identityKey, Date.now() + AUTH_MENU_QUOTA_FAILURE_COOLDOWN_MS)
          }
          input.log?.debug("quota check refresh failed", {
            index,
            mode,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }

      if (!accessToken) continue

      if (!account.identityKey) {
        hydrateAccountIdentityFromAccessClaims(account)
      }
      if (!account.identityKey) continue

      const snapshot = await fetchQuotaSnapshotFromBackend({
        accessToken,
        accountId: account.accountId,
        now: Date.now(),
        modelFamily: "gpt-5.3-codex",
        userAgent: resolveRequestUserAgent(input.spoofMode, resolveCodexOriginator(input.spoofMode)),
        log: input.log,
        timeoutMs: AUTH_MENU_QUOTA_FETCH_TIMEOUT_MS
      })
      if (!snapshot) {
        input.cooldownByIdentity.set(account.identityKey, Date.now() + AUTH_MENU_QUOTA_FAILURE_COOLDOWN_MS)
        continue
      }

      input.cooldownByIdentity.delete(account.identityKey)

      snapshotUpdates[account.identityKey] = snapshot
    }
  }

  if (Object.keys(snapshotUpdates).length === 0) return

  await saveSnapshots(snapshotPath, (current) => ({
    ...current,
    ...snapshotUpdates
  }))
}
