import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import type { Config } from "@opencode-ai/sdk"
import process from "node:process"

import { loadAuthStorage, setAccountCooldown } from "./storage.js"
import type { Logger } from "./logger.js"
import type { OpenAIAuthMode, RotationStrategy } from "./types.js"
import type {
  BehaviorSettings,
  CodexSpoofMode,
  CustomModelConfig,
  PersonalityOption,
  PluginRuntimeMode,
  PromptCacheKeyStrategy
} from "./config.js"
import { formatToastMessage } from "./toast.js"
import { applyCodexCatalogToProviderModels, getCodexModelCatalog, type CodexModelInfo } from "./model-catalog.js"
import { createRequestSnapshots } from "./request-snapshots.js"
import { resolveCodexOriginator } from "./codex-native/originator.js"
import { tryOpenUrlInBrowser as openUrlInBrowser } from "./codex-native/browser.js"
import {
  buildCodexUserAgent,
  refreshCodexClientVersionFromGitHub,
  resolveCodexClientVersion,
  resolveRequestUserAgent
} from "./codex-native/client-identity.js"
import { createOAuthServerController } from "./codex-native/oauth-server.js"
import {
  buildAuthorizeUrl,
  buildOAuthErrorHtml,
  buildOAuthSuccessHtml,
  ISSUER,
  composeCodexSuccessRedirectUrl,
  exchangeCodeForTokens,
  generatePKCE,
  OAUTH_CALLBACK_ORIGIN,
  OAUTH_CALLBACK_PATH,
  OAUTH_CALLBACK_TIMEOUT_MS,
  OAUTH_CALLBACK_URI,
  OAUTH_DUMMY_KEY,
  OAUTH_LOOPBACK_HOST,
  OAUTH_PORT,
  OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS,
  OAUTH_SERVER_SHUTDOWN_GRACE_MS,
  type PkceCodes,
  type TokenResponse
} from "./codex-native/oauth-utils.js"
import { refreshQuotaSnapshotsForAuthMenu as refreshQuotaSnapshotsForAuthMenuBase } from "./codex-native/auth-menu-quotas.js"
import { persistOAuthTokensForMode } from "./codex-native/oauth-persistence.js"
import { createBrowserOAuthAuthorize, createHeadlessOAuthAuthorize } from "./codex-native/oauth-auth-methods.js"
import { runInteractiveAuthMenu as runInteractiveAuthMenuBase } from "./codex-native/auth-menu-flow.js"
import {
  handleChatHeadersHook,
  handleChatMessageHook,
  handleChatParamsHook,
  handleSessionCompactingHook,
  handleTextCompleteHook
} from "./codex-native/chat-hooks.js"
import { createSessionAffinityRuntimeState } from "./codex-native/session-affinity-state.js"
import { initializeCatalogSync, selectCatalogAuthCandidate } from "./codex-native/catalog-sync.js"
import { createOpenAIFetchHandler } from "./codex-native/openai-loader-fetch.js"
export { browserOpenInvocationFor } from "./codex-native/browser.js"
export { upsertAccount } from "./codex-native/accounts.js"
export { extractAccountId, extractAccountIdFromClaims, refreshAccessToken } from "./codex-native/oauth-utils.js"

const INTERNAL_COLLABORATION_MODE_HEADER = "x-opencode-collaboration-mode-kind"
const INTERNAL_COLLABORATION_AGENT_HEADER = "x-opencode-collaboration-agent-kind"
const INTERNAL_CATALOG_SCOPE_HEADER = "x-opencode-catalog-scope-key"
const SESSION_AFFINITY_MISSING_GRACE_MS = 15 * 60 * 1000
const REASONING_VARIANT_KEYS = ["none", "minimal", "low", "medium", "high", "xhigh"] as const

const CODEX_RS_COMPACT_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.
`

const CODEX_RS_COMPACT_SUMMARY_PREFIX =
  "Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:"

export async function tryOpenUrlInBrowser(url: string, log?: Logger): Promise<boolean> {
  return openUrlInBrowser({
    url,
    allowedOrigins: [ISSUER],
    log,
    onEvent: (event, meta) => oauthServerController.emitDebug(event, meta ?? {})
  })
}

export const __testOnly = {
  buildAuthorizeUrl,
  generatePKCE,
  buildOAuthSuccessHtml,
  buildOAuthErrorHtml,
  composeCodexSuccessRedirectUrl,
  modeForRuntimeMode,
  buildCodexUserAgent,
  resolveRequestUserAgent,
  resolveCodexClientVersion,
  refreshCodexClientVersionFromGitHub,
  isOAuthDebugEnabled,
  stopOAuthServer
}

const oauthServerController = createOAuthServerController<PkceCodes, TokenResponse>({
  port: OAUTH_PORT,
  loopbackHost: OAUTH_LOOPBACK_HOST,
  callbackOrigin: OAUTH_CALLBACK_ORIGIN,
  callbackUri: OAUTH_CALLBACK_URI,
  callbackPath: OAUTH_CALLBACK_PATH,
  callbackTimeoutMs: OAUTH_CALLBACK_TIMEOUT_MS,
  buildOAuthErrorHtml,
  buildOAuthSuccessHtml,
  composeCodexSuccessRedirectUrl,
  exchangeCodeForTokens
})

function isOAuthDebugEnabled(): boolean {
  return oauthServerController.isDebugEnabled()
}

async function startOAuthServer(): Promise<{ redirectUri: string }> {
  return oauthServerController.start()
}

function stopOAuthServer(): void {
  oauthServerController.stop()
}

function scheduleOAuthServerStop(
  delayMs = OAUTH_SERVER_SHUTDOWN_GRACE_MS,
  reason: "success" | "error" | "other" = "other"
): void {
  oauthServerController.scheduleStop(delayMs, reason)
}

function waitForOAuthCallback(pkce: PkceCodes, state: string, authMode: OpenAIAuthMode): Promise<TokenResponse> {
  return oauthServerController.waitForCallback(pkce, state, authMode)
}

function modeForRuntimeMode(runtimeMode: PluginRuntimeMode): OpenAIAuthMode {
  return runtimeMode === "native" ? "native" : "codex"
}

export type CodexAuthPluginOptions = {
  log?: Logger
  personality?: PersonalityOption
  behaviorSettings?: BehaviorSettings
  customModels?: Record<string, CustomModelConfig>
  mode?: PluginRuntimeMode
  quietMode?: boolean
  pidOffsetEnabled?: boolean
  rotationStrategy?: RotationStrategy
  promptCacheKeyStrategy?: PromptCacheKeyStrategy
  spoofMode?: CodexSpoofMode
  compatInputSanitizer?: boolean
  remapDeveloperMessagesToUser?: boolean
  codexCompactionOverride?: boolean
  headerSnapshots?: boolean
  headerSnapshotBodies?: boolean
  headerTransformDebug?: boolean
  collaborationProfileEnabled?: boolean
  orchestratorSubagentsEnabled?: boolean
}

type ConfigWithProviderVariants = Config & {
  provider?: Record<
    string,
    {
      models?: Record<
        string,
        Record<string, unknown> & {
          variants?: Record<string, Record<string, unknown>>
        }
      >
    }
  >
}

function cloneConfigValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneConfigValue(entry)) as T
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, cloneConfigValue(entry)])
    ) as T
  }
  return value
}

function getSupportedReasoningEfforts(model: CodexModelInfo): string[] {
  return Array.from(
    new Set(
      (model.supported_reasoning_levels ?? [])
        .flatMap((level) => (typeof level.effort === "string" ? [level.effort] : []))
        .filter((effort): effort is string => effort.length > 0)
    )
  )
}

function buildVariantConfigOverrides(model: CodexModelInfo): Record<string, Record<string, unknown>> | undefined {
  const supportedEfforts = getSupportedReasoningEfforts(model)
  if (supportedEfforts.length === 0) return undefined

  return Object.fromEntries(
    REASONING_VARIANT_KEYS.map((variant) => {
      if (!supportedEfforts.includes(variant)) {
        return [variant, { disabled: true }]
      }
      return [
        variant,
        {
          reasoningEffort: variant,
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"]
        }
      ]
    })
  )
}

function applyCatalogVariantOverridesToConfig(config: Config, catalogModels: CodexModelInfo[] | undefined): void {
  if (!catalogModels || catalogModels.length === 0) return

  const nextConfig = config as ConfigWithProviderVariants
  const provider = (nextConfig.provider ??= {})
  const openai = (provider.openai ??= {})
  const models = (openai.models ??= {})

  for (const catalogModel of catalogModels) {
    const overrides = buildVariantConfigOverrides(catalogModel)
    if (!overrides) continue
    const modelEntry = (models[catalogModel.slug] ??= {})
    modelEntry.variants = {
      ...(modelEntry.variants ?? {}),
      ...overrides
    }
  }
}

function applyCustomModelsToConfig(
  config: Config,
  customModels: Record<string, CustomModelConfig> | undefined,
  warn?: (message: string) => void
): void {
  if (!customModels || Object.keys(customModels).length === 0) return

  const nextConfig = config as ConfigWithProviderVariants
  const provider = (nextConfig.provider ??= {})
  const openai = (provider.openai ??= {})
  const models = (openai.models ??= {})

  for (const [slug, customModel] of Object.entries(customModels)) {
    const target = customModel.targetModel.trim()
    const targetEntry = models[target]
    if (!targetEntry) {
      warn?.(
        `[opencode-codex-auth] customModels.${slug}.targetModel points to ${JSON.stringify(target)}, but that model is not available in the current provider config. Skipping custom model synthesis.`
      )
      delete models[slug]
      continue
    }

    const nextEntry = cloneConfigValue(targetEntry)
    nextEntry.id = slug
    nextEntry.slug = slug
    nextEntry.model = slug
    if (customModel.name) {
      nextEntry.name = customModel.name
      nextEntry.displayName = customModel.name
      nextEntry.display_name = customModel.name
    }

    const nextApi =
      typeof nextEntry.api === "object" && nextEntry.api !== null && !Array.isArray(nextEntry.api)
        ? (nextEntry.api as Record<string, unknown>)
        : {}
    nextApi.id = target
    nextEntry.api = nextApi

    const baseVariants =
      typeof nextEntry.variants === "object" && nextEntry.variants !== null && !Array.isArray(nextEntry.variants)
        ? (nextEntry.variants as Record<string, Record<string, unknown>>)
        : {}
    const overlayVariants = Object.fromEntries(
      Object.entries(customModel.variants ?? {}).map(([variantName, variantValue]) => [
        variantName,
        cloneConfigValue(variantValue ?? {})
      ])
    )
    nextEntry.variants = {
      ...baseVariants,
      ...Object.fromEntries(
        Object.entries(overlayVariants).map(([variantName, variantValue]) => [
          variantName,
          {
            ...(baseVariants[variantName] ?? {}),
            ...variantValue
          }
        ])
      )
    }

    models[slug] = nextEntry
  }
}

export async function CodexAuthPlugin(input: PluginInput, opts: CodexAuthPluginOptions = {}): Promise<Hooks> {
  opts.log?.debug("codex-native init")
  const codexCompactionSummaryPrefixSessions = new Set<string>()
  const spoofModeFromOptions: CodexSpoofMode =
    (opts.spoofMode as string | undefined) === "codex" || (opts.spoofMode as string | undefined) === "strict"
      ? "codex"
      : "native"
  const runtimeMode: PluginRuntimeMode =
    opts.mode === "codex" || opts.mode === "native" ? opts.mode : spoofModeFromOptions === "codex" ? "codex" : "native"
  const spoofMode: CodexSpoofMode = opts.mode ? (runtimeMode === "codex" ? "codex" : "native") : spoofModeFromOptions
  const authMode: OpenAIAuthMode = modeForRuntimeMode(runtimeMode)
  const remapDeveloperMessagesToUserEnabled = runtimeMode === "codex" && opts.remapDeveloperMessagesToUser !== false
  const codexCompactionOverrideEnabled =
    opts.codexCompactionOverride !== undefined ? opts.codexCompactionOverride : runtimeMode === "codex"
  const collaborationProfileEnabled =
    typeof opts.collaborationProfileEnabled === "boolean" ? opts.collaborationProfileEnabled : runtimeMode === "codex"
  const orchestratorSubagentsEnabled =
    typeof opts.orchestratorSubagentsEnabled === "boolean"
      ? opts.orchestratorSubagentsEnabled
      : collaborationProfileEnabled
  void refreshCodexClientVersionFromGitHub(opts.log).catch((error) => {
    if (error instanceof Error) {
      // best-effort background refresh
    }
  })
  const resolveCatalogHeaders = (): {
    originator: string
    userAgent: string
    clientVersion: string
    versionHeader: string
    openaiBeta?: string
  } => {
    const originator = resolveCodexOriginator(spoofMode)
    const codexClientVersion = resolveCodexClientVersion()
    return {
      originator,
      userAgent: resolveRequestUserAgent(spoofMode, originator),
      clientVersion: codexClientVersion,
      versionHeader: codexClientVersion,
      ...(spoofMode === "native" ? { openaiBeta: "responses=experimental" } : {})
    }
  }
  const requestSnapshots = createRequestSnapshots({
    enabled: opts.headerSnapshots === true || opts.headerTransformDebug === true,
    captureBodies: opts.headerSnapshotBodies === true,
    log: opts.log
  })
  const catalogModelsByScope = new Map<string, CodexModelInfo[]>()
  const catalogScopeKeyBySession = new Map<string, string>()
  let activeCatalogScopeKey: string | undefined
  let activeCatalogModels: CodexModelInfo[] | undefined
  let providerModelsForCatalogSync: Record<string, Record<string, unknown>> | undefined
  const quotaFetchCooldownByIdentity = new Map<string, number>()
  const activateCatalogScope = (scopeKey: string | undefined): void => {
    const normalizedScopeKey = scopeKey?.trim() || undefined
    activeCatalogScopeKey = normalizedScopeKey
    activeCatalogModels = normalizedScopeKey ? catalogModelsByScope.get(normalizedScopeKey) : undefined
    if (!providerModelsForCatalogSync) return
    applyCodexCatalogToProviderModels({
      providerModels: providerModelsForCatalogSync,
      catalogModels: activeCatalogModels,
      personality: opts.personality,
      customModels: opts.customModels,
      warn: (message) => console.warn(message)
    })
  }
  const setCatalogModels = (scopeKey: string | undefined, models: CodexModelInfo[] | undefined): void => {
    const normalizedScopeKey = scopeKey?.trim() || undefined
    if (normalizedScopeKey) {
      if (models && models.length > 0) {
        catalogModelsByScope.set(normalizedScopeKey, models)
      } else {
        catalogModelsByScope.delete(normalizedScopeKey)
      }
    }
    if (normalizedScopeKey !== activeCatalogScopeKey) return
    activeCatalogModels = models
    if (!providerModelsForCatalogSync) return
    applyCodexCatalogToProviderModels({
      providerModels: providerModelsForCatalogSync,
      catalogModels: activeCatalogModels,
      personality: opts.personality,
      customModels: opts.customModels,
      warn: (message) => console.warn(message)
    })
  }
  const getCatalogModels = (scopeKey?: string): CodexModelInfo[] | undefined => {
    const normalizedScopeKey = scopeKey?.trim()
    if (normalizedScopeKey) {
      return catalogModelsByScope.get(normalizedScopeKey)
    }
    return activeCatalogModels
  }
  const showToast = async (
    message: string,
    variant: "info" | "success" | "warning" | "error" = "info",
    quietMode: boolean = false
  ): Promise<void> => {
    if (quietMode) return
    const tui = input.client?.tui
    if (!tui || typeof tui.showToast !== "function") return
    try {
      await tui.showToast({ body: { message: formatToastMessage(message), variant } })
    } catch (error) {
      opts.log?.debug("toast failed", {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const refreshQuotaSnapshotsForAuthMenu = async (): Promise<void> => {
    await refreshQuotaSnapshotsForAuthMenuBase({
      spoofMode,
      log: opts.log,
      cooldownByIdentity: quotaFetchCooldownByIdentity
    })
  }

  const runInteractiveAuthMenu = async (options: { allowExit: boolean }): Promise<"add" | "exit"> => {
    return runInteractiveAuthMenuBase({
      authMode,
      allowExit: options.allowExit,
      refreshQuotaSnapshotsForAuthMenu
    })
  }

  const persistOAuthTokens = async (tokens: TokenResponse): Promise<void> => {
    await persistOAuthTokensForMode(tokens, authMode)
  }

  return {
    async config(config) {
      try {
        const catalogAuth = await selectCatalogAuthCandidate(
          authMode,
          opts.pidOffsetEnabled === true,
          opts.rotationStrategy
        )
        const catalogModels = await getCodexModelCatalog({
          accessToken: catalogAuth.accessToken,
          accountId: catalogAuth.accountId,
          ...resolveCatalogHeaders(),
          onEvent: (event) => opts.log?.debug("codex model catalog", event)
        })
        applyCatalogVariantOverridesToConfig(config, catalogModels)
        applyCustomModelsToConfig(config, opts.customModels, (message) => console.warn(message))
      } catch (error) {
        if (error instanceof Error) {
          opts.log?.debug("config variant override failed", { error: error.message })
        }
      }
    },
    auth: {
      provider: "openai",
      async loader(getAuth, provider) {
        const auth = await getAuth()
        let hasOAuth = auth.type === "oauth"
        if (!hasOAuth) {
          try {
            const stored = await loadAuthStorage()
            hasOAuth = stored.openai?.type === "oauth"
          } catch (error) {
            if (error instanceof Error) {
              // treat storage read issues as missing oauth
            }
            hasOAuth = false
          }
        }
        if (!hasOAuth) return {}

        const { orchestratorState, stickySessionState, hybridSessionState, persistSessionAffinityState } =
          await createSessionAffinityRuntimeState({
            authMode,
            env: process.env,
            missingGraceMs: SESSION_AFFINITY_MISSING_GRACE_MS,
            log: opts.log
          })
        const providerModels = provider.models as Record<string, Record<string, unknown>>
        providerModelsForCatalogSync = providerModels

        const syncCatalogFromAuth = await initializeCatalogSync({
          authMode,
          pidOffsetEnabled: opts.pidOffsetEnabled === true,
          rotationStrategy: opts.rotationStrategy,
          resolveCatalogHeaders,
          log: opts.log,
          setCatalogModels,
          activateCatalogScope
        })

        const fetch = createOpenAIFetchHandler({
          authMode,
          spoofMode,
          promptCacheKeyStrategy: opts.promptCacheKeyStrategy,
          projectPath: typeof input.worktree === "string" && input.worktree.trim() ? input.worktree : process.cwd(),
          remapDeveloperMessagesToUserEnabled,
          behaviorSettings: opts.behaviorSettings,
          personality: opts.personality,
          log: opts.log,
          quietMode: opts.quietMode === true,
          pidOffsetEnabled: opts.pidOffsetEnabled === true,
          configuredRotationStrategy: opts.rotationStrategy,
          headerTransformDebug: opts.headerTransformDebug === true,
          compatInputSanitizerEnabled: opts.compatInputSanitizer === true,
          internalCatalogScopeHeader: INTERNAL_CATALOG_SCOPE_HEADER,
          internalCollaborationModeHeader: INTERNAL_COLLABORATION_MODE_HEADER,
          internalCollaborationAgentHeader: INTERNAL_COLLABORATION_AGENT_HEADER,
          requestSnapshots,
          sessionAffinityState: {
            orchestratorState,
            stickySessionState,
            hybridSessionState,
            persistSessionAffinityState
          },
          getCatalogModels,
          getActiveCatalogScopeKey: () => activeCatalogScopeKey,
          activateCatalogScope,
          syncCatalogFromAuth,
          setCooldown: async (idKey, cooldownUntil) => {
            await setAccountCooldown(undefined, idKey, cooldownUntil, authMode)
          },
          showToast
        })

        return {
          apiKey: OAUTH_DUMMY_KEY,
          fetch
        }
      },
      methods: [
        {
          label: "ChatGPT Pro/Plus (browser)",
          type: "oauth",
          authorize: createBrowserOAuthAuthorize({
            authMode,
            spoofMode,
            runInteractiveAuthMenu,
            startOAuthServer,
            waitForOAuthCallback,
            scheduleOAuthServerStop,
            persistOAuthTokens,
            openAuthUrl: (url: string) => {
              void tryOpenUrlInBrowser(url, opts.log)
            },
            shutdownGraceMs: OAUTH_SERVER_SHUTDOWN_GRACE_MS,
            shutdownErrorGraceMs: OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS
          })
        },
        {
          label: "ChatGPT Pro/Plus (headless)",
          type: "oauth",
          authorize: createHeadlessOAuthAuthorize({ spoofMode, persistOAuthTokens })
        },
        {
          label: "Manually enter API Key",
          type: "api"
        }
      ]
    },
    "chat.message": async (hookInput, output) => {
      await handleChatMessageHook({ hookInput, output, client: input.client })
    },
    "chat.params": async (hookInput, output) => {
      const requestCatalogModels = activeCatalogModels
      const requestCatalogScopeKey = activeCatalogScopeKey
      await handleChatParamsHook({
        hookInput,
        output,
        lastCatalogModels: requestCatalogModels,
        behaviorSettings: opts.behaviorSettings,
        fallbackPersonality: opts.personality,
        spoofMode,
        collaborationProfileEnabled,
        orchestratorSubagentsEnabled
      })

      const sessionID = typeof (hookInput as { sessionID?: unknown }).sessionID === "string" ? hookInput.sessionID : ""
      if (!sessionID) return
      if (hookInput.model.providerID !== "openai" || !requestCatalogScopeKey) {
        catalogScopeKeyBySession.delete(sessionID)
        return
      }
      catalogScopeKeyBySession.set(sessionID, requestCatalogScopeKey)
    },
    "chat.headers": async (hookInput, output) => {
      const requestCatalogScopeKey = catalogScopeKeyBySession.get(hookInput.sessionID) ?? activeCatalogScopeKey
      await handleChatHeadersHook({
        hookInput,
        output,
        spoofMode,
        requestCatalogScopeKey,
        internalCatalogScopeHeader: INTERNAL_CATALOG_SCOPE_HEADER,
        internalCollaborationModeHeader: INTERNAL_COLLABORATION_MODE_HEADER,
        internalCollaborationAgentHeader: INTERNAL_COLLABORATION_AGENT_HEADER,
        collaborationProfileEnabled,
        orchestratorSubagentsEnabled
      })
      catalogScopeKeyBySession.delete(hookInput.sessionID)
    },
    "experimental.session.compacting": async (hookInput, output) => {
      await handleSessionCompactingHook({
        enabled: codexCompactionOverrideEnabled,
        hookInput,
        output,
        client: input.client,
        summaryPrefixSessions: codexCompactionSummaryPrefixSessions,
        compactPrompt: CODEX_RS_COMPACT_PROMPT
      })
    },
    "experimental.text.complete": async (hookInput, output) => {
      await handleTextCompleteHook({
        enabled: codexCompactionOverrideEnabled,
        hookInput,
        output,
        client: input.client,
        summaryPrefixSessions: codexCompactionSummaryPrefixSessions,
        compactSummaryPrefix: CODEX_RS_COMPACT_SUMMARY_PREFIX
      })
    }
  }
}
