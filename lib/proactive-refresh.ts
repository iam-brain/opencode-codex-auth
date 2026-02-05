import { saveAuthStorage } from "./storage"
import type { OpenAIMultiOauthAuth } from "./types"

export async function runOneProactiveRefreshTick(input: {
  authPath?: string
  now: () => number
  bufferMs: number
  refresh: (refreshToken: string) => Promise<{ access: string; refresh: string; expires: number }>
}): Promise<void> {
  const leaseMs = 120_000

  while (true) {
    let claimed: { identityKey: string; refresh: string } | undefined

    await saveAuthStorage(input.authPath, (auth) => {
      const openai = auth.openai
      if (!openai || openai.type !== "oauth" || !("accounts" in openai)) return

      const multi = openai as OpenAIMultiOauthAuth
      const now = input.now()
      const dueCutoff = now + input.bufferMs
      const account = multi.accounts.find((candidate) => {
        if (candidate.enabled === false) return false
        if (!candidate.identityKey || !candidate.refresh || !candidate.expires) return false
        if (candidate.expires > dueCutoff) return false
        if (
          typeof candidate.refreshLeaseUntil === "number" &&
          candidate.refreshLeaseUntil > now
        ) {
          return false
        }
        return true
      })

      if (!account) return

      account.refreshLeaseUntil = now + leaseMs
      claimed = {
        identityKey: account.identityKey,
        refresh: account.refresh
      }
    })

    if (!claimed) return

    let tokens: { access: string; refresh: string; expires: number }
    try {
      tokens = await input.refresh(claimed.refresh)
    } catch {
      // Keep the lease until it expires to avoid immediate re-claim loops.
      continue
    }

    await saveAuthStorage(input.authPath, (auth) => {
      const openai = auth.openai
      if (!openai || openai.type !== "oauth" || !("accounts" in openai)) return
      const multi = openai as OpenAIMultiOauthAuth
      const account = multi.accounts.find(
        (candidate) => candidate.identityKey === claimed.identityKey
      )
      if (!account) return
      if (account.enabled === false) {
        delete account.refreshLeaseUntil
        return
      }

      const now = input.now()
      if (
        typeof account.refreshLeaseUntil === "number" &&
        account.refreshLeaseUntil > now
      ) {
        account.access = tokens.access
        account.refresh = tokens.refresh
        account.expires = tokens.expires
        delete account.refreshLeaseUntil
      } else if (typeof account.refreshLeaseUntil === "number") {
        delete account.refreshLeaseUntil
      }
    })
  }
}
