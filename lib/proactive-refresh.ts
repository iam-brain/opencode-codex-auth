import { ensureOpenAIOAuthDomain, listOpenAIOAuthDomains, saveAuthStorage } from "./storage.js"
import type { OpenAIAuthMode } from "./types.js"

const PROACTIVE_REFRESH_FAILURE_COOLDOWN_MS = 30_000
const TERMINAL_REFRESH_ERROR_CODES = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "refresh_token_revoked",
  "token_revoked"
])

function isInvalidGrantError(error: unknown): boolean {
  const oauthCode =
    typeof error === "object" && error !== null && "oauthCode" in error
      ? (error as { oauthCode?: unknown }).oauthCode
      : undefined
  if (typeof oauthCode === "string") {
    const normalized = oauthCode.trim().toLowerCase()
    if (TERMINAL_REFRESH_ERROR_CODES.has(normalized)) {
      return true
    }
  }

  if (error instanceof Error) {
    const message = error.message.trim().toLowerCase()
    if (message.includes("invalid_grant")) return true
    if (message.includes("refresh token") && (message.includes("invalid") || message.includes("revoked"))) {
      return true
    }
  }

  return false
}

export async function runOneProactiveRefreshTick(input: {
  authPath?: string
  now: () => number
  bufferMs: number
  refresh: (refreshToken: string) => Promise<{ access: string; refresh: string; expires: number }>
}): Promise<void> {
  const leaseMs = 120_000

  const processDomain = async (authMode: OpenAIAuthMode): Promise<void> => {
    const staleClaimIdentityKeys = new Set<string>()

    while (true) {
      let claimed: { identityKey: string; refresh: string; leaseUntil: number } | undefined

      await saveAuthStorage(input.authPath, (auth) => {
        const domain = ensureOpenAIOAuthDomain(auth, authMode)
        const now = input.now()
        const dueCutoff = now + input.bufferMs
        const account = domain.accounts.find((candidate) => {
          if (candidate.enabled === false) return false
          if (!candidate.identityKey || !candidate.refresh || candidate.expires === undefined) {
            return false
          }
          if (staleClaimIdentityKeys.has(candidate.identityKey)) return false
          if (candidate.expires > dueCutoff) return false
          if (typeof candidate.cooldownUntil === "number" && candidate.cooldownUntil > now) {
            return false
          }
          if (typeof candidate.refreshLeaseUntil === "number" && candidate.refreshLeaseUntil > now) {
            return false
          }
          return true
        })

        if (!account) return

        const identityKey = account.identityKey
        const refreshToken = account.refresh
        if (!identityKey || !refreshToken) return

        const leaseUntil = now + leaseMs
        account.refreshLeaseUntil = leaseUntil
        claimed = {
          identityKey,
          refresh: refreshToken,
          leaseUntil
        }
      })

      if (!claimed) return
      const claimedAccount = claimed

      let tokens: { access: string; refresh: string; expires: number }
      try {
        tokens = await input.refresh(claimedAccount.refresh)
      } catch (error) {
        const invalidGrant = isInvalidGrantError(error)
        await saveAuthStorage(input.authPath, (auth) => {
          const domain = ensureOpenAIOAuthDomain(auth, authMode)
          const account = domain.accounts.find((candidate) => candidate.identityKey === claimedAccount.identityKey)
          if (!account) return
          if (
            account.refreshLeaseUntil !== claimedAccount.leaseUntil ||
            account.refresh !== claimedAccount.refresh
          ) {
            staleClaimIdentityKeys.add(claimedAccount.identityKey)
            if (account.refreshLeaseUntil === claimedAccount.leaseUntil) {
              delete account.refreshLeaseUntil
            }
            return
          }
          delete account.refreshLeaseUntil
          if (invalidGrant) {
            account.enabled = false
            delete account.cooldownUntil
            return
          }
          if (account.enabled === false) return
          account.cooldownUntil = input.now() + PROACTIVE_REFRESH_FAILURE_COOLDOWN_MS
        })
        continue
      }

      await saveAuthStorage(input.authPath, (auth) => {
        const domain = ensureOpenAIOAuthDomain(auth, authMode)
        const account = domain.accounts.find((candidate) => candidate.identityKey === claimedAccount.identityKey)
        if (!account) return
        if (
          account.refreshLeaseUntil !== claimedAccount.leaseUntil ||
          account.refresh !== claimedAccount.refresh
        ) {
          staleClaimIdentityKeys.add(claimedAccount.identityKey)
          if (account.refreshLeaseUntil === claimedAccount.leaseUntil) {
            delete account.refreshLeaseUntil
          }
          return
        }
        if (account.enabled === false) {
          delete account.refreshLeaseUntil
          return
        }

        const now = input.now()
        const dueCutoff = now + input.bufferMs
        const nextExpires = Number.isFinite(tokens.expires) ? tokens.expires : 0
        account.access = tokens.access
        account.refresh = tokens.refresh
        account.expires = nextExpires
        delete account.refreshLeaseUntil
        if (nextExpires <= dueCutoff) {
          account.cooldownUntil = now + PROACTIVE_REFRESH_FAILURE_COOLDOWN_MS
        } else {
          delete account.cooldownUntil
        }
      })
    }
  }

  const initial = await saveAuthStorage(input.authPath, (auth) => auth)
  const modes = listOpenAIOAuthDomains(initial).map((entry) => entry.mode)
  for (const authMode of modes) {
    await processDomain(authMode)
  }
}
