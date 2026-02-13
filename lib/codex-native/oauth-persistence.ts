import { extractEmailFromClaims, extractPlanFromClaims, parseJwtClaims } from "../claims"
import { ensureOpenAIOAuthDomain, saveAuthStorage } from "../storage"
import type { AccountRecord, OpenAIAuthMode } from "../types"
import { upsertAccount } from "./accounts"
import { extractAccountId, type TokenResponse } from "./oauth-utils"

export async function persistOAuthTokensForMode(tokens: TokenResponse, authMode: OpenAIAuthMode): Promise<void> {
  const now = Date.now()
  const expires = now + (tokens.expires_in ?? 3600) * 1000
  const claims = parseJwtClaims(tokens.id_token ?? tokens.access_token)

  const account: AccountRecord = {
    enabled: true,
    refresh: tokens.refresh_token,
    access: tokens.access_token,
    expires,
    accountId: extractAccountId(tokens),
    email: extractEmailFromClaims(claims),
    plan: extractPlanFromClaims(claims),
    lastUsed: now
  }

  await saveAuthStorage(undefined, async (authFile) => {
    const domain = ensureOpenAIOAuthDomain(authFile, authMode)
    const stored = upsertAccount(domain, { ...account, authTypes: [authMode] })
    if (stored.identityKey) {
      domain.activeIdentityKey = stored.identityKey
    }
    return authFile
  })
}
