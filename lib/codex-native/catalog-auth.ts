import { selectAccount } from "../rotation"
import { getOpenAIOAuthDomain, loadAuthStorage } from "../storage"
import type { OpenAIAuthMode, RotationStrategy } from "../types"

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

    const selected = selectAccount({
      accounts: domain.accounts,
      strategy: rotationStrategy ?? domain.strategy,
      activeIdentityKey: domain.activeIdentityKey,
      now: Date.now(),
      stickyPidOffset: pidOffsetEnabled
    })

    if (!selected?.access) {
      return { accountId: selected?.accountId }
    }

    if (selected.expires && selected.expires <= Date.now()) {
      return { accountId: selected.accountId }
    }

    return {
      accessToken: selected.access,
      accountId: selected.accountId
    }
  } catch {
    return {}
  }
}
