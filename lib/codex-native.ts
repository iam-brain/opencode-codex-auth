import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import process from "node:process"

import { loadAuthStorage, setAccountCooldown } from "./storage.js"
import type { Logger } from "./logger.js"
import type { OpenAIAuthMode, RotationStrategy } from "./types.js"
import type {
  BehaviorSettings,
  CodexSpoofMode,
  PersonalityOption,
  PluginRuntimeMode,
  PromptCacheKeyStrategy
} from "./config.js"
import { formatToastMessage } from "./toast.js"
import type { CodexModelInfo } from "./model-catalog.js"
import { createRequestSnapshots } from "./request-snapshots.js"
import { resolveCodexOriginator, type CodexOriginator } from "./codex-native/originator.js"
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
import { initializeCatalogSync } from "./codex-native/catalog-sync.js"
import { createOpenAIFetchHandler } from "./codex-native/openai-loader-fetch.js"
export { browserOpenInvocationFor } from "./codex-native/browser.js"
export { upsertAccount } from "./codex-native/accounts.js"
export { extractAccountId, extractAccountIdFromClaims, refreshAccessToken } from "./codex-native/oauth-utils.js"

const INTERNAL_COLLABORATION_MODE_HEADER = "x-opencode-collaboration-mode-kind"
const INTERNAL_COLLABORATION_AGENT_HEADER = "x-opencode-collaboration-agent-kind"
const SESSION_AFFINITY_MISSING_GRACE_MS = 15 * 60 * 1000

const STATIC_FALLBACK_MODELS = [
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.3-codex",
  "gpt-5.1-codex"
]

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
  let lastCatalogModels: CodexModelInfo[] | undefined
  const quotaFetchCooldownByIdentity = new Map<string, number>()
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

        const syncCatalogFromAuth = await initializeCatalogSync({
          authMode,
          pidOffsetEnabled: opts.pidOffsetEnabled === true,
          rotationStrategy: opts.rotationStrategy,
          resolveCatalogHeaders,
          providerModels: provider.models as Record<string, Record<string, unknown>>,
          fallbackModels: STATIC_FALLBACK_MODELS,
          personality: opts.personality,
          log: opts.log,
          getLastCatalogModels: () => lastCatalogModels,
          setLastCatalogModels: (models) => {
            lastCatalogModels = models
          }
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
          internalCollaborationModeHeader: INTERNAL_COLLABORATION_MODE_HEADER,
          internalCollaborationAgentHeader: INTERNAL_COLLABORATION_AGENT_HEADER,
          requestSnapshots,
          sessionAffinityState: {
            orchestratorState,
            stickySessionState,
            hybridSessionState,
            persistSessionAffinityState
          },
          getCatalogModels: () => lastCatalogModels,
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
      await handleChatParamsHook({
        hookInput,
        output,
        lastCatalogModels,
        behaviorSettings: opts.behaviorSettings,
        fallbackPersonality: opts.personality,
        spoofMode,
        collaborationProfileEnabled,
        orchestratorSubagentsEnabled
      })
    },
    "chat.headers": async (hookInput, output) => {
      await handleChatHeadersHook({
        hookInput,
        output,
        spoofMode,
        internalCollaborationModeHeader: INTERNAL_COLLABORATION_MODE_HEADER,
        internalCollaborationAgentHeader: INTERNAL_COLLABORATION_AGENT_HEADER,
        collaborationProfileEnabled,
        orchestratorSubagentsEnabled
      })
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
