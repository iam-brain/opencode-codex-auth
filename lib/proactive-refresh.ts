import { ensureOpenAIOAuthDomain, listOpenAIOAuthDomains, saveAuthStorage } from "./storage.js"
import type { OpenAIAuthMode } from "./types.js"

const PROACTIVE_REFRESH_FAILURE_COOLDOWN_MS = 30_000

function isInvalidGrantError(error: unknown): boolean {
  const oauthCode =
    typeof error === "object" && error !== null && "oauthCode" in error
      ? (error as { oauthCode?: unknown }).oauthCode
      : undefined
  if (typeof oauthCode === "string" && oauthCode.toLowerCase() === "invalid_grant") {
    return true
  }

  if (error instanceof Error) {
    return error.message.toLowerCase().includes("invalid_grant")
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
    while (true) {
      let claimed: { identityKey: string; refresh: string } | undefined

      await saveAuthStorage(input.authPath, (auth) => {
        const domain = ensureOpenAIOAuthDomain(auth, authMode)
        const now = input.now()
        const dueCutoff = now + input.bufferMs
        const account = domain.accounts.find((candidate) => {
          if (candidate.enabled === false) return false
          if (!candidate.identityKey || !candidate.refresh || candidate.expires === undefined) {
            return false
          }
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

        account.refreshLeaseUntil = now + leaseMs
        claimed = {
          identityKey,
          refresh: refreshToken
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
        if (account.enabled === false) {
          delete account.refreshLeaseUntil
          return
        }

        const now = input.now()
        if (typeof account.refreshLeaseUntil === "number" && account.refreshLeaseUntil > now) {
          account.access = tokens.access
          account.refresh = tokens.refresh
          account.expires = tokens.expires
          delete account.refreshLeaseUntil
          delete account.cooldownUntil
        } else if (typeof account.refreshLeaseUntil === "number") {
          delete account.refreshLeaseUntil
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
