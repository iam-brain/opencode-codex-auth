import type { Logger } from "../logger.js"
import { getCodexModelCatalog, type CodexModelInfo } from "../model-catalog.js"
import { selectAccount } from "../rotation.js"
import { getOpenAIOAuthDomain, loadAuthStorage } from "../storage.js"
import type { OpenAIAuthMode, RotationStrategy } from "../types.js"
import { resolveCatalogScopeKey } from "./openai-loader-fetch-state.js"

type CatalogHeaders = {
  originator: string
  userAgent: string
  clientVersion: string
  versionHeader: string
  openaiBeta?: string
}

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

export async function initializeCatalogSync(input: {
  authMode: OpenAIAuthMode
  pidOffsetEnabled: boolean
  rotationStrategy?: RotationStrategy
  resolveCatalogHeaders: () => CatalogHeaders
  log?: Logger
  setCatalogModels: (scopeKey: string | undefined, models: CodexModelInfo[] | undefined) => void
  activateCatalogScope: (scopeKey: string | undefined) => void
}): Promise<
  (auth: {
    accessToken?: string
    accountId?: string
    identityKey?: string
    email?: string
    plan?: string
    selectionTrace?: { attemptKey?: string }
  }) => Promise<CodexModelInfo[] | undefined>
> {
  const catalogAuth = await selectCatalogAuthCandidate(input.authMode, input.pidOffsetEnabled, input.rotationStrategy)

  const initialCatalog = await getCodexModelCatalog({
    accessToken: catalogAuth.accessToken,
    accountId: catalogAuth.accountId,
    ...input.resolveCatalogHeaders(),
    onEvent: (event) => input.log?.debug("codex model catalog", event)
  })

  const initialScopeKey = resolveCatalogScopeKey(catalogAuth)
  input.setCatalogModels(initialScopeKey, initialCatalog)
  input.activateCatalogScope(initialScopeKey)

  return async (auth): Promise<CodexModelInfo[] | undefined> => {
    if (!auth.accessToken) return undefined
    const refreshedCatalog = await getCodexModelCatalog({
      accessToken: auth.accessToken,
      accountId: auth.accountId,
      ...input.resolveCatalogHeaders(),
      onEvent: (event) => input.log?.debug("codex model catalog", event)
    })
    input.setCatalogModels(resolveCatalogScopeKey(auth), refreshedCatalog)
    return refreshedCatalog
  }
}
