import { extractEmailFromClaims, extractPlanFromClaims, parseJwtClaims } from "../claims.js"
import { ensureOpenAIOAuthDomain, saveAuthStorage } from "../storage.js"
import type { AccountRecord, OpenAIAuthMode } from "../types.js"
import { upsertAccount } from "./accounts.js"
import { extractAccountId, type TokenResponse } from "./oauth-utils.js"

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
    if (!authFile.openai || authFile.openai.type !== "oauth") {
      authFile.openai = {
        type: "oauth",
        accounts: []
      }
    }
    const domain = ensureOpenAIOAuthDomain(authFile, authMode)
    const stored = upsertAccount(domain, { ...account, authTypes: [authMode] })
    if (stored.identityKey) {
      domain.activeIdentityKey = stored.identityKey
    }
    return authFile
  })
}
