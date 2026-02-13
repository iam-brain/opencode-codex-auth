import type { Hooks, PluginInput } from "@opencode-ai/plugin"

import { extractEmailFromClaims, extractPlanFromClaims, parseJwtClaims } from "./claims"
import { CodexStatus, type HeaderMap } from "./codex-status"
import { saveSnapshots } from "./codex-status-storage"
import { PluginFatalError, isPluginFatalError, toSyntheticErrorResponse } from "./fatal-errors"
import { buildIdentityKey, ensureIdentityKey } from "./identity"
import { defaultSessionAffinityPath, defaultSnapshotsPath } from "./paths"
import { createStickySessionState } from "./rotation"
import {
  ensureOpenAIOAuthDomain,
  getOpenAIOAuthDomain,
  importLegacyInstallData,
  loadAuthStorage,
  saveAuthStorage,
  setAccountCooldown,
  shouldOfferLegacyTransfer
} from "./storage"
import { toolOutputForStatus } from "./codex-status-tool"
import type { Logger } from "./logger"
import type { AccountRecord, AuthFile, OpenAIAuthMode, OpenAIOAuthDomain, RotationStrategy } from "./types"
import { FetchOrchestrator, createFetchOrchestratorState } from "./fetch-orchestrator"
import type { CodexSpoofMode, CustomSettings, PersonalityOption, PluginRuntimeMode } from "./config"
import { formatToastMessage } from "./toast"
import { runAuthMenuOnce } from "./ui/auth-menu-runner"
import { shouldUseColor } from "./ui/tty/ansi"
import { applyCodexCatalogToProviderModels, getCodexModelCatalog, type CodexModelInfo } from "./model-catalog"
import { createRequestSnapshots } from "./request-snapshots"
import { sanitizeOutboundRequestIfNeeded } from "./codex-native/request-transform"
import {
  createSessionExistsFn,
  loadSessionAffinity,
  pruneSessionAffinitySnapshot,
  readSessionAffinitySnapshot,
  saveSessionAffinity,
  writeSessionAffinitySnapshot
} from "./session-affinity"
import { resolveCodexOriginator, type CodexOriginator } from "./codex-native/originator"
import { tryOpenUrlInBrowser as openUrlInBrowser } from "./codex-native/browser"
import { selectCatalogAuthCandidate } from "./codex-native/catalog-auth"
import {
  buildCodexUserAgent,
  refreshCodexClientVersionFromGitHub,
  resolveCodexClientVersion,
  resolveRequestUserAgent
} from "./codex-native/client-identity"
import { createOAuthServerController } from "./codex-native/oauth-server"
import {
  buildAuthMenuAccounts,
  ensureAccountAuthTypes,
  findDomainAccountIndex,
  formatAccountLabel,
  hydrateAccountIdentityFromAccessClaims,
  reconcileActiveIdentityKey,
  upsertAccount
} from "./codex-native/accounts"
import {
  buildAuthorizeUrl,
  buildOAuthErrorHtml,
  buildOAuthSuccessHtml,
  composeCodexSuccessRedirectUrl,
  exchangeCodeForTokens,
  extractAccountId,
  extractAccountIdFromClaims,
  generatePKCE,
  ISSUER,
  OAUTH_CALLBACK_ORIGIN,
  OAUTH_CALLBACK_PATH,
  OAUTH_CALLBACK_TIMEOUT_MS,
  OAUTH_CALLBACK_URI,
  OAUTH_DUMMY_KEY,
  OAUTH_LOOPBACK_HOST,
  OAUTH_PORT,
  OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS,
  OAUTH_SERVER_SHUTDOWN_GRACE_MS,
  refreshAccessToken,
  type PkceCodes,
  type TokenResponse
} from "./codex-native/oauth-utils"
import { asString, isRecord } from "./codex-native/session-messages"
import { assertAllowedOutboundUrl, rewriteUrl } from "./codex-native/request-routing"
import { acquireOpenAIAuth } from "./codex-native/acquire-auth"
import { refreshQuotaSnapshotsForAuthMenu as refreshQuotaSnapshotsForAuthMenuBase } from "./codex-native/auth-menu-quotas"
import { persistOAuthTokensForMode } from "./codex-native/oauth-persistence"
import { createBrowserOAuthAuthorize, createHeadlessOAuthAuthorize } from "./codex-native/oauth-auth-methods"
import { runInteractiveAuthMenu as runInteractiveAuthMenuBase } from "./codex-native/auth-menu-flow"
import {
  handleChatHeadersHook,
  handleChatMessageHook,
  handleChatParamsHook,
  handleSessionCompactingHook,
  handleTextCompleteHook
} from "./codex-native/chat-hooks"
import { applyRequestTransformPipeline } from "./codex-native/request-transform-pipeline"
export { browserOpenInvocationFor } from "./codex-native/browser"
export { upsertAccount }
export { extractAccountId, extractAccountIdFromClaims, refreshAccessToken }

const INTERNAL_COLLABORATION_MODE_HEADER = "x-opencode-collaboration-mode-kind"
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
  customSettings?: CustomSettings
  mode?: PluginRuntimeMode
  quietMode?: boolean
  pidOffsetEnabled?: boolean
  rotationStrategy?: RotationStrategy
  spoofMode?: CodexSpoofMode
  compatInputSanitizer?: boolean
  remapDeveloperMessagesToUser?: boolean
  codexCompactionOverride?: boolean
  headerSnapshots?: boolean
  headerTransformDebug?: boolean
}

export async function CodexAuthPlugin(input: PluginInput, opts: CodexAuthPluginOptions = {}): Promise<Hooks> {
  opts.log?.debug("codex-native init")
  const codexCompactionSummaryPrefixSessions = new Set<string>()
  const spoofMode: CodexSpoofMode =
    (opts.spoofMode as string | undefined) === "codex" || (opts.spoofMode as string | undefined) === "strict"
      ? "codex"
      : "native"
  const runtimeMode: PluginRuntimeMode =
    opts.mode === "codex" || opts.mode === "native" ? opts.mode : spoofMode === "codex" ? "codex" : "native"
  const authMode: OpenAIAuthMode = modeForRuntimeMode(runtimeMode)
  const remapDeveloperMessagesToUserEnabled = spoofMode === "codex" && opts.remapDeveloperMessagesToUser !== false
  const codexCompactionOverrideEnabled =
    opts.codexCompactionOverride !== undefined ? opts.codexCompactionOverride : runtimeMode === "codex"
  void refreshCodexClientVersionFromGitHub(opts.log).catch(() => {})
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
          } catch {
            hasOAuth = false
          }
        }
        if (!hasOAuth) return {}

        const sessionAffinityPath = defaultSessionAffinityPath()
        const loadedSessionAffinity = await loadSessionAffinity(sessionAffinityPath).catch(() => ({
          version: 1 as const
        }))
        const initialSessionAffinity = readSessionAffinitySnapshot(loadedSessionAffinity, authMode)
        const sessionExists = createSessionExistsFn(process.env)
        await pruneSessionAffinitySnapshot(initialSessionAffinity, sessionExists, {
          missingGraceMs: SESSION_AFFINITY_MISSING_GRACE_MS
        }).catch(() => 0)

        const orchestratorState = createFetchOrchestratorState()
        orchestratorState.seenSessionKeys = initialSessionAffinity.seenSessionKeys

        const stickySessionState = createStickySessionState()
        stickySessionState.bySessionKey = initialSessionAffinity.stickyBySessionKey
        const hybridSessionState = createStickySessionState()
        hybridSessionState.bySessionKey = initialSessionAffinity.hybridBySessionKey

        let sessionAffinityPersistQueue = Promise.resolve()
        const persistSessionAffinityState = (): void => {
          sessionAffinityPersistQueue = sessionAffinityPersistQueue
            .then(async () => {
              await pruneSessionAffinitySnapshot(
                {
                  seenSessionKeys: orchestratorState.seenSessionKeys,
                  stickyBySessionKey: stickySessionState.bySessionKey,
                  hybridBySessionKey: hybridSessionState.bySessionKey
                },
                sessionExists,
                {
                  missingGraceMs: SESSION_AFFINITY_MISSING_GRACE_MS
                }
              )
              await saveSessionAffinity(
                async (current) =>
                  writeSessionAffinitySnapshot(current, authMode, {
                    seenSessionKeys: orchestratorState.seenSessionKeys,
                    stickyBySessionKey: stickySessionState.bySessionKey,
                    hybridBySessionKey: hybridSessionState.bySessionKey
                  }),
                sessionAffinityPath
              )
            })
            .catch(() => {
              // best-effort persistence
            })
        }

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
        const applyCatalogModels = (models: CodexModelInfo[] | undefined): void => {
          if (models) {
            lastCatalogModels = models
          }
          applyCodexCatalogToProviderModels({
            providerModels: provider.models as Record<string, Record<string, unknown>>,
            catalogModels: models ?? lastCatalogModels,
            fallbackModels: STATIC_FALLBACK_MODELS,
            personality: opts.personality
          })
        }
        applyCatalogModels(catalogModels)
        const syncCatalogFromAuth = async (auth: {
          accessToken?: string
          accountId?: string
        }): Promise<CodexModelInfo[] | undefined> => {
          if (!auth.accessToken) return undefined
          const refreshedCatalog = await getCodexModelCatalog({
            accessToken: auth.accessToken,
            accountId: auth.accountId,
            ...resolveCatalogHeaders(),
            onEvent: (event) => opts.log?.debug("codex model catalog", event)
          })
          applyCatalogModels(refreshedCatalog)
          return refreshedCatalog
        }

        return {
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: string | URL | Request, init?: RequestInit) {
            const baseRequest = new Request(requestInput, init)
            if (opts.headerTransformDebug === true) {
              await requestSnapshots.captureRequest("before-header-transform", baseRequest, {
                spoofMode
              })
            }
            let outbound = new Request(rewriteUrl(baseRequest), baseRequest)
            const inboundOriginator = outbound.headers.get("originator")?.trim()
            const outboundOriginator =
              inboundOriginator === "opencode" ||
              inboundOriginator === "codex_exec" ||
              inboundOriginator === "codex_cli_rs"
                ? inboundOriginator
                : resolveCodexOriginator(spoofMode)
            outbound.headers.set("originator", outboundOriginator)
            const inboundUserAgent = outbound.headers.get("user-agent")?.trim()
            if (spoofMode === "native" && inboundUserAgent) {
              outbound.headers.set("user-agent", inboundUserAgent)
            } else {
              outbound.headers.set("user-agent", resolveRequestUserAgent(spoofMode, outboundOriginator))
            }
            if (outbound.headers.has(INTERNAL_COLLABORATION_MODE_HEADER)) {
              outbound.headers.delete(INTERNAL_COLLABORATION_MODE_HEADER)
            }
            const transformed = await applyRequestTransformPipeline({
              request: outbound,
              spoofMode,
              remapDeveloperMessagesToUserEnabled,
              catalogModels: lastCatalogModels,
              customSettings: opts.customSettings,
              fallbackPersonality: opts.personality
            })
            outbound = transformed.request
            const isSubagentRequest = transformed.isSubagentRequest
            if (opts.headerTransformDebug === true) {
              await requestSnapshots.captureRequest("after-header-transform", outbound, {
                spoofMode,
                instructionsOverridden: transformed.instructionOverride.changed,
                instructionOverrideReason: transformed.instructionOverride.reason,
                developerMessagesRemapped: transformed.developerRoleRemap.changed,
                developerMessageRemapReason: transformed.developerRoleRemap.reason,
                developerMessageRemapCount: transformed.developerRoleRemap.remappedCount,
                developerMessagePreservedCount: transformed.developerRoleRemap.preservedCount,
                ...(isSubagentRequest ? { subagent: transformed.subagentHeader } : {})
              })
            }
            let selectedIdentityKey: string | undefined

            await requestSnapshots.captureRequest("before-auth", outbound, { spoofMode })

            const orchestrator = new FetchOrchestrator({
              acquireAuth: async (context) => {
                const auth = await acquireOpenAIAuth({
                  authMode,
                  context,
                  isSubagentRequest,
                  stickySessionState,
                  hybridSessionState,
                  seenSessionKeys: orchestratorState.seenSessionKeys,
                  persistSessionAffinityState,
                  pidOffsetEnabled: opts.pidOffsetEnabled === true,
                  configuredRotationStrategy: opts.rotationStrategy,
                  log: opts.log
                })

                if (spoofMode === "codex") {
                  const shouldAwaitCatalog = !lastCatalogModels || lastCatalogModels.length === 0
                  if (shouldAwaitCatalog) {
                    try {
                      await syncCatalogFromAuth({ accessToken: auth.access, accountId: auth.accountId })
                    } catch {
                      // best-effort catalog load; request can still proceed
                    }
                  } else {
                    void syncCatalogFromAuth({ accessToken: auth.access, accountId: auth.accountId }).catch(() => {})
                  }
                } else {
                  void syncCatalogFromAuth({ accessToken: auth.access, accountId: auth.accountId }).catch(() => {})
                }

                selectedIdentityKey = auth.identityKey
                return auth
              },
              setCooldown: async (idKey, cooldownUntil) => {
                await setAccountCooldown(undefined, idKey, cooldownUntil, authMode)
              },
              quietMode: opts.quietMode === true,
              state: orchestratorState,
              onSessionObserved: ({ event, sessionKey }) => {
                if (isSubagentRequest) {
                  orchestratorState.seenSessionKeys.delete(sessionKey)
                  stickySessionState.bySessionKey.delete(sessionKey)
                  hybridSessionState.bySessionKey.delete(sessionKey)
                  return
                }
                if (event === "new" || event === "resume" || event === "switch") {
                  persistSessionAffinityState()
                }
              },
              showToast,
              onAttemptRequest: async ({ attempt, maxAttempts, request, auth, sessionKey }) => {
                const transformed = await applyRequestTransformPipeline({
                  request,
                  spoofMode,
                  remapDeveloperMessagesToUserEnabled,
                  catalogModels: lastCatalogModels,
                  customSettings: opts.customSettings,
                  fallbackPersonality: opts.personality
                })
                await requestSnapshots.captureRequest("outbound-attempt", transformed.request, {
                  attempt: attempt + 1,
                  maxAttempts,
                  sessionKey,
                  identityKey: auth.identityKey,
                  accountLabel: auth.accountLabel,
                  instructionsOverridden: transformed.instructionOverride.changed,
                  instructionOverrideReason: transformed.instructionOverride.reason,
                  developerMessagesRemapped: transformed.developerRoleRemap.changed,
                  developerMessageRemapReason: transformed.developerRoleRemap.reason,
                  developerMessageRemapCount: transformed.developerRoleRemap.remappedCount,
                  developerMessagePreservedCount: transformed.developerRoleRemap.preservedCount
                })
                return transformed.request
              },
              onAttemptResponse: async ({ attempt, maxAttempts, response, auth, sessionKey }) => {
                await requestSnapshots.captureResponse("outbound-response", response, {
                  attempt: attempt + 1,
                  maxAttempts,
                  sessionKey,
                  identityKey: auth.identityKey,
                  accountLabel: auth.accountLabel
                })
              }
            })

            const sanitizedOutbound = await sanitizeOutboundRequestIfNeeded(
              outbound,
              opts.compatInputSanitizer === true
            )
            if (sanitizedOutbound.changed) {
              opts.log?.debug("compat input sanitizer applied", { mode: spoofMode })
            }
            await requestSnapshots.captureRequest("after-sanitize", sanitizedOutbound.request, {
              spoofMode,
              sanitized: sanitizedOutbound.changed
            })
            try {
              assertAllowedOutboundUrl(new URL(sanitizedOutbound.request.url))
            } catch (error) {
              if (isPluginFatalError(error)) {
                return toSyntheticErrorResponse(error)
              }
              return toSyntheticErrorResponse(
                new PluginFatalError({
                  message: "Outbound request validation failed before sending to OpenAI backend.",
                  status: 400,
                  type: "disallowed_outbound_request",
                  param: "request"
                })
              )
            }

            let response: Response
            try {
              response = await orchestrator.execute(sanitizedOutbound.request)
            } catch (error) {
              if (isPluginFatalError(error)) {
                opts.log?.debug("fatal auth/error response", {
                  type: error.type,
                  status: error.status
                })
                return toSyntheticErrorResponse(error)
              }
              opts.log?.debug("unexpected fetch failure", {
                error: error instanceof Error ? error.message : String(error)
              })
              return toSyntheticErrorResponse(
                new PluginFatalError({
                  message:
                    "OpenAI request failed unexpectedly. Retry once, and if it persists run `opencode auth login`.",
                  status: 502,
                  type: "plugin_fetch_failed",
                  param: "request"
                })
              )
            }

            if (selectedIdentityKey) {
              const headers: HeaderMap = {}
              response.headers.forEach((value, key) => {
                headers[key.toLowerCase()] = value
              })

              const status = new CodexStatus()
              const snapshot = status.parseFromHeaders({
                now: Date.now(),
                modelFamily: "codex",
                headers
              })

              if (snapshot.limits.length > 0) {
                void saveSnapshots(defaultSnapshotsPath(), (current) => ({
                  ...current,
                  [selectedIdentityKey as string]: snapshot
                })).catch(() => {})
              }
            }

            return response
          }
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
        customSettings: opts.customSettings,
        fallbackPersonality: opts.personality,
        spoofMode
      })
    },
    "chat.headers": async (hookInput, output) => {
      await handleChatHeadersHook({
        hookInput,
        output,
        spoofMode,
        internalCollaborationModeHeader: INTERNAL_COLLABORATION_MODE_HEADER
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
