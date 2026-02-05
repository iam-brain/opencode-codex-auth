import { loadAuthStorage, updateAccountTokensByIdentityKey } from "./storage"
import type { OpenAIMultiOauthAuth } from "./types"

export async function runOneProactiveRefreshTick(input: {
  authPath?: string
  now: () => number
  bufferMs: number
  refresh: (refreshToken: string) => Promise<{ access: string; refresh: string; expires: number }>
}): Promise<void> {
  const auth = await loadAuthStorage(input.authPath)
  const openai = auth.openai
  if (!openai || openai.type !== "oauth" || !("accounts" in openai)) {
    return
  }

  const multi = openai as OpenAIMultiOauthAuth
  const now = input.now()

  for (const account of multi.accounts) {
    if (account.enabled === false) continue
    if (!account.identityKey || !account.refresh || !account.expires) continue

    if (account.expires <= now + input.bufferMs) {
      try {
        const tokens = await input.refresh(account.refresh)
        await updateAccountTokensByIdentityKey(input.authPath, account.identityKey, {
          access: tokens.access,
          refresh: tokens.refresh,
          expires: tokens.expires
        })
      } catch {
        // best-effort background work
      }
    }
  }
}
