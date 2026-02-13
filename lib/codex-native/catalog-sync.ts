import type { PersonalityOption } from "../config"
import type { Logger } from "../logger"
import { applyCodexCatalogToProviderModels, getCodexModelCatalog, type CodexModelInfo } from "../model-catalog"
import type { OpenAIAuthMode, RotationStrategy } from "../types"
import { selectCatalogAuthCandidate } from "./catalog-auth"

type CatalogHeaders = {
  originator: string
  userAgent: string
  clientVersion: string
  versionHeader: string
  openaiBeta?: string
}

export async function initializeCatalogSync(input: {
  authMode: OpenAIAuthMode
  pidOffsetEnabled: boolean
  rotationStrategy?: RotationStrategy
  resolveCatalogHeaders: () => CatalogHeaders
  providerModels: Record<string, Record<string, unknown>>
  fallbackModels: string[]
  personality?: PersonalityOption
  log?: Logger
  getLastCatalogModels: () => CodexModelInfo[] | undefined
  setLastCatalogModels: (models: CodexModelInfo[] | undefined) => void
}): Promise<(auth: { accessToken?: string; accountId?: string }) => Promise<CodexModelInfo[] | undefined>> {
  const catalogAuth = await selectCatalogAuthCandidate(input.authMode, input.pidOffsetEnabled, input.rotationStrategy)

  const applyCatalogModels = (models: CodexModelInfo[] | undefined): void => {
    if (models) {
      input.setLastCatalogModels(models)
    }
    applyCodexCatalogToProviderModels({
      providerModels: input.providerModels,
      catalogModels: models ?? input.getLastCatalogModels(),
      fallbackModels: input.fallbackModels,
      personality: input.personality
    })
  }

  const initialCatalog = await getCodexModelCatalog({
    accessToken: catalogAuth.accessToken,
    accountId: catalogAuth.accountId,
    ...input.resolveCatalogHeaders(),
    onEvent: (event) => input.log?.debug("codex model catalog", event)
  })

  applyCatalogModels(initialCatalog)

  return async (auth: { accessToken?: string; accountId?: string }): Promise<CodexModelInfo[] | undefined> => {
    if (!auth.accessToken) return undefined
    const refreshedCatalog = await getCodexModelCatalog({
      accessToken: auth.accessToken,
      accountId: auth.accountId,
      ...input.resolveCatalogHeaders(),
      onEvent: (event) => input.log?.debug("codex model catalog", event)
    })
    applyCatalogModels(refreshedCatalog)
    return refreshedCatalog
  }
}
