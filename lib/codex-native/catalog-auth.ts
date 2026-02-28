import { selectAccount } from "../rotation.js"
import { getOpenAIOAuthDomain, loadAuthStorage } from "../storage.js"
import type { OpenAIAuthMode, RotationStrategy } from "../types.js"

export async function selectCatalogAuthCandidate(
  authMode: OpenAIAuthMode,
  pidOffsetEnabled: boolean,
  rotationStrategy?: RotationStrategy
): Promise<{ accessToken?: string; accountId?: string }> {
  try {
    const auth = await loadAuthStorage()
    const domain = getOpenAIOAuthDomain(auth, authMode)
    if (!domain) {
      return {}
    }
    const now = Date.now()

    const selected = selectAccount({
      accounts: domain.accounts,
      strategy: rotationStrategy ?? domain.strategy,
      activeIdentityKey: domain.activeIdentityKey,
      now,
      stickyPidOffset: pidOffsetEnabled
    })

    if (!selected?.access) {
      return { accountId: selected?.accountId }
    }

    const expires = selected.expires
    if (typeof expires !== "number" || !Number.isFinite(expires) || expires <= now) {
      return { accountId: selected.accountId }
    }

    return {
      accessToken: selected.access,
      accountId: selected.accountId
    }
  } catch (error) {
    if (error instanceof Error) {
      // best-effort catalog auth selection
    }
    return {}
  }
}
