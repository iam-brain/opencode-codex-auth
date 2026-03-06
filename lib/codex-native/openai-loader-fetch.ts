import { FetchOrchestrator } from "../fetch-orchestrator.js"
import { PluginFatalError, isPluginFatalError, toSyntheticErrorResponse } from "../fatal-errors.js"
import type { Logger } from "../logger.js"
import type { CodexModelInfo } from "../model-catalog.js"
import type { RotationStrategy } from "../types.js"
import type { BehaviorSettings, CodexSpoofMode, PersonalityOption, PromptCacheKeyStrategy } from "../config.js"
import type { OpenAIAuthMode } from "../types.js"
import type { QuotaThresholdTrackerState } from "../quota-threshold-alerts.js"
import { acquireOpenAIAuth } from "./acquire-auth.js"
import { resolveRequestUserAgent } from "./client-identity.js"
import { resolveCodexOriginator } from "./originator.js"
import { buildProjectPromptCacheKey } from "../prompt-cache-key.js"
import { persistRateLimitSnapshotFromResponse } from "./rate-limit-snapshots.js"
import { assertAllowedOutboundUrl, rewriteUrl } from "./request-routing.js"
import {
  type OutboundRequestPayloadTransformResult,
  transformOutboundRequestPayload
} from "./request-transform-payload.js"
import type { SessionAffinityRuntimeState } from "./session-affinity-state.js"
import { scheduleQuotaRefresh } from "./openai-loader-fetch-quota.js"
import {
  CATALOG_REFRESH_FAILURE_RETRY_MS,
  CATALOG_REFRESH_TTL_MS,
  getCatalogSyncState,
  pruneQuotaState,
  resolveCatalogScopeKey,
  stripUnsafeForwardedHeaders,
  type CatalogSyncState
} from "./openai-loader-fetch-state.js"
type SnapshotRecorder = {
  captureRequest: (stage: string, request: Request, metadata?: Record<string, unknown>) => Promise<void>
  captureResponse: (stage: string, response: Response, metadata?: Record<string, unknown>) => Promise<void>
}
export type CreateOpenAIFetchHandlerInput = {
  authMode: OpenAIAuthMode
  spoofMode: CodexSpoofMode
  remapDeveloperMessagesToUserEnabled: boolean
  behaviorSettings?: BehaviorSettings
  personality?: PersonalityOption
  promptCacheKeyStrategy?: PromptCacheKeyStrategy
  projectPath?: string
  log?: Logger
  quietMode: boolean
  pidOffsetEnabled: boolean
  configuredRotationStrategy?: RotationStrategy
  headerTransformDebug: boolean
  compatInputSanitizerEnabled: boolean
  internalCatalogScopeHeader?: string
  internalCollaborationModeHeader: string
  internalCollaborationAgentHeader?: string
  requestSnapshots: SnapshotRecorder
  sessionAffinityState: SessionAffinityRuntimeState
  getCatalogModels: (scopeKey?: string) => CodexModelInfo[] | undefined
  getActiveCatalogScopeKey?: () => string | undefined
  activateCatalogScope?: (scopeKey: string | undefined) => void
  syncCatalogFromAuth: (auth: {
    accessToken?: string
    accountId?: string
    identityKey?: string
    email?: string
    plan?: string
    selectionTrace?: { attemptKey?: string }
  }) => Promise<CodexModelInfo[] | undefined>
  setCooldown: (idKey: string, cooldownUntil: number) => Promise<void>
  showToast: (message: string, variant?: "info" | "success" | "warning" | "error", quietMode?: boolean) => Promise<void>
}

export function createOpenAIFetchHandler(input: CreateOpenAIFetchHandlerInput) {
  const internalCatalogScopeHeader = input.internalCatalogScopeHeader ?? "x-opencode-catalog-scope-key"
  const internalCollaborationAgentHeader =
    input.internalCollaborationAgentHeader ?? "x-opencode-collaboration-agent-kind"
  const quotaTrackerByIdentity = new Map<string, QuotaThresholdTrackerState>()
  const quotaRefreshAtByIdentity = new Map<string, number>()
  const catalogSyncByScope = new Map<string, CatalogSyncState>()

  return async (requestInput: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const initialRequestUrl =
      requestInput instanceof Request
        ? requestInput.url
        : requestInput instanceof URL
          ? requestInput.toString()
          : requestInput

    try {
      assertAllowedOutboundUrl(new URL(initialRequestUrl))
    } catch (error) {
      if (isPluginFatalError(error)) {
        return toSyntheticErrorResponse(error)
      }
      return toSyntheticErrorResponse(
        new PluginFatalError({
          message: "Outbound request validation failed before preparing OpenAI request.",
          status: 400,
          type: "disallowed_outbound_request",
          param: "request"
        })
      )
    }

    let baseRequest: Request
    try {
      baseRequest = new Request(requestInput, init)
    } catch {
      return toSyntheticErrorResponse(
        new PluginFatalError({
          message: "Outbound request could not be prepared for OpenAI backend.",
          status: 400,
          type: "disallowed_outbound_request",
          param: "request"
        })
      )
    }
    if (input.headerTransformDebug) {
      await input.requestSnapshots.captureRequest("before-header-transform", baseRequest, {
        spoofMode: input.spoofMode
      })
    }

    let outbound = new Request(rewriteUrl(baseRequest), baseRequest)
    stripUnsafeForwardedHeaders(outbound.headers)
    const inboundOriginator = outbound.headers.get("originator")?.trim()
    const outboundOriginator =
      inboundOriginator === "opencode" || inboundOriginator === "codex_exec" || inboundOriginator === "codex_cli_rs"
        ? inboundOriginator
        : resolveCodexOriginator(input.spoofMode)
    outbound.headers.set("originator", outboundOriginator)

    const inboundUserAgent = outbound.headers.get("user-agent")?.trim()
    if (input.spoofMode === "native" && inboundUserAgent) {
      outbound.headers.set("user-agent", inboundUserAgent)
    } else {
      outbound.headers.set("user-agent", resolveRequestUserAgent(input.spoofMode, outboundOriginator))
    }

    if (outbound.headers.has(input.internalCollaborationModeHeader)) {
      outbound.headers.delete(input.internalCollaborationModeHeader)
    }
    if (outbound.headers.has(internalCollaborationAgentHeader)) {
      outbound.headers.delete(internalCollaborationAgentHeader)
    }
    const subagentHeader = outbound.headers.get("x-openai-subagent")?.trim()
    const isSubagentRequest = Boolean(subagentHeader)

    let selectedIdentityKey: string | undefined
    let selectedAuthForQuota: { access: string; accountId?: string; identityKey?: string } | undefined
    let selectedCatalogModels: CodexModelInfo[] | undefined
    let selectedPreviousCatalogScopeKey: string | undefined
    const promptCacheKeyStrategy = input.promptCacheKeyStrategy ?? "default"
    const promptCacheKeyOverride =
      promptCacheKeyStrategy === "project"
        ? buildProjectPromptCacheKey({
            projectPath: input.projectPath ?? process.cwd(),
            spoofMode: input.spoofMode
          })
        : undefined

    await input.requestSnapshots.captureRequest("before-auth", outbound, { spoofMode: input.spoofMode })

    const { orchestratorState, stickySessionState, hybridSessionState, persistSessionAffinityState } =
      input.sessionAffinityState

    const orchestrator = new FetchOrchestrator({
      acquireAuth: async (context) => {
        const auth = await acquireOpenAIAuth({
          authMode: input.authMode,
          context,
          isSubagentRequest,
          stickySessionState,
          hybridSessionState,
          seenSessionKeys: orchestratorState.seenSessionKeys,
          persistSessionAffinityState,
          pidOffsetEnabled: input.pidOffsetEnabled,
          configuredRotationStrategy: input.configuredRotationStrategy,
          log: input.log
        })

        const now = Date.now()
        const catalogScopeKey = resolveCatalogScopeKey(auth)
        selectedPreviousCatalogScopeKey = input.getActiveCatalogScopeKey?.()
        const cachedCatalog = input.getCatalogModels(catalogScopeKey)
        if (input.getActiveCatalogScopeKey?.() !== catalogScopeKey) {
          input.activateCatalogScope?.(catalogScopeKey)
        }

        let currentCatalog = cachedCatalog
        const shouldAwaitCatalog = !currentCatalog || currentCatalog.length === 0
        const catalogSyncState = getCatalogSyncState(catalogSyncByScope, catalogScopeKey)
        const refreshRetryMs =
          catalogSyncState.lastFailureAt > 0 ? CATALOG_REFRESH_FAILURE_RETRY_MS : CATALOG_REFRESH_TTL_MS
        const shouldRefreshCatalog =
          catalogSyncState.lastAttemptAt === 0 || now - catalogSyncState.lastAttemptAt >= refreshRetryMs

        if (shouldRefreshCatalog) {
          if (!catalogSyncState.inFlight) {
            catalogSyncState.lastAttemptAt = now
            const syncPromise = input
              .syncCatalogFromAuth({
                accessToken: auth.access,
                accountId: auth.accountId,
                identityKey: auth.identityKey,
                email: auth.email,
                plan: auth.plan,
                selectionTrace: auth.selectionTrace
              })
              .then(() => {
                catalogSyncState.lastFailureAt = 0
              })
              .catch((error) => {
                if (error instanceof Error) {
                  // best-effort catalog refresh
                }
                catalogSyncState.lastFailureAt = Date.now()
              })
            const inFlight = syncPromise.finally(() => {
              const latest = catalogSyncByScope.get(catalogScopeKey)
              if (latest?.inFlight === inFlight) {
                latest.inFlight = null
              }
            })
            catalogSyncState.inFlight = inFlight
          }
        }
        if (shouldAwaitCatalog && catalogSyncState.inFlight) {
          await catalogSyncState.inFlight
        }
        currentCatalog = input.getCatalogModels(catalogScopeKey)
        selectedCatalogModels = currentCatalog

        selectedIdentityKey = auth.identityKey
        selectedAuthForQuota = {
          access: auth.access,
          accountId: auth.accountId,
          identityKey: auth.identityKey
        }
        return auth
      },
      setCooldown: input.setCooldown,
      quietMode: input.quietMode,
      state: orchestratorState,
      onSessionObserved: async ({ event }) => {
        if (isSubagentRequest) return
        if (event === "new" || event === "resume" || event === "switch") {
          await persistSessionAffinityState()
        }
      },
      validateRedirectUrl: (url) => {
        assertAllowedOutboundUrl(url)
      },
      maxRedirects: 3,
      showToast: input.showToast,
      onAttemptRequest: async ({ attempt, maxAttempts, attemptReasonCode, request, auth, sessionKey }) => {
        const requestCatalogScopeKey =
          request.headers.get(internalCatalogScopeHeader)?.trim() || selectedPreviousCatalogScopeKey
        if (request.headers.has(internalCatalogScopeHeader)) {
          request.headers.delete(internalCatalogScopeHeader)
        }
        const selectedCatalogScopeKey = resolveCatalogScopeKey(auth)
        const requestCatalogModels = requestCatalogScopeKey ? input.getCatalogModels(requestCatalogScopeKey) : undefined
        const requestCatalogScopeChanged =
          (Boolean(requestCatalogScopeKey) && requestCatalogScopeKey !== selectedCatalogScopeKey) ||
          (selectedCatalogModels === undefined && Boolean(requestCatalogModels))
        const payloadTransform: OutboundRequestPayloadTransformResult = await transformOutboundRequestPayload({
          request,
          stripReasoningReplayEnabled: true,
          remapDeveloperMessagesToUserEnabled: input.remapDeveloperMessagesToUserEnabled,
          compatInputSanitizerEnabled: input.compatInputSanitizerEnabled,
          promptCacheKeyOverrideEnabled: promptCacheKeyStrategy === "project",
          promptCacheKeyOverride,
          catalogModels: selectedCatalogModels,
          previousCatalogModels: requestCatalogModels,
          requestCatalogScopeChanged,
          fallbackPersonality: input.personality,
          behaviorSettings: input.behaviorSettings
        })

        if (input.headerTransformDebug) {
          await input.requestSnapshots.captureRequest("after-header-transform", payloadTransform.request, {
            spoofMode: input.spoofMode,
            serviceTierOverridden: payloadTransform.serviceTier.changed,
            serviceTierOverrideReason: payloadTransform.serviceTier.reason,
            ...(payloadTransform.serviceTier.serviceTier
              ? { serviceTier: payloadTransform.serviceTier.serviceTier }
              : {}),
            developerMessagesRemapped: payloadTransform.developerRoleRemap.changed,
            developerMessageRemapReason: payloadTransform.developerRoleRemap.reason,
            developerMessageRemapCount: payloadTransform.developerRoleRemap.remappedCount,
            developerMessagePreservedCount: payloadTransform.developerRoleRemap.preservedCount,
            ...(isSubagentRequest ? { subagent: subagentHeader } : {})
          })
        }

        if (payloadTransform.replay.changed) {
          input.log?.debug("reasoning replay stripped", {
            removedPartCount: payloadTransform.replay.removedPartCount,
            removedFieldCount: payloadTransform.replay.removedFieldCount
          })
        }

        await input.requestSnapshots.captureRequest("after-sanitize", payloadTransform.request, {
          spoofMode: input.spoofMode,
          sanitized: payloadTransform.compatSanitizer.changed
        })

        await input.requestSnapshots.captureRequest("outbound-attempt", payloadTransform.request, {
          attempt: attempt + 1,
          maxAttempts,
          attemptReasonCode,
          sessionKey,
          identityKey: auth.identityKey,
          accountLabel: auth.accountLabel,
          developerMessagesRemapped: payloadTransform.developerRoleRemap.changed,
          developerMessageRemapReason: payloadTransform.developerRoleRemap.reason,
          developerMessageRemapCount: payloadTransform.developerRoleRemap.remappedCount,
          developerMessagePreservedCount: payloadTransform.developerRoleRemap.preservedCount,
          promptCacheKeyOverridden: payloadTransform.promptCacheKey.changed,
          promptCacheKeyOverrideReason:
            promptCacheKeyStrategy === "project" ? payloadTransform.promptCacheKey.reason : "default_strategy",
          ...(input.headerTransformDebug === true && auth.selectionTrace
            ? {
                selectionStrategy: auth.selectionTrace.strategy,
                selectionDecision: auth.selectionTrace.decision,
                selectionTotalCount: auth.selectionTrace.totalCount,
                selectionDisabledCount: auth.selectionTrace.disabledCount,
                selectionCooldownCount: auth.selectionTrace.cooldownCount,
                selectionRefreshLeaseCount: auth.selectionTrace.refreshLeaseCount,
                selectionEligibleCount: auth.selectionTrace.eligibleCount,
                ...(typeof auth.selectionTrace.attemptedCount === "number"
                  ? { selectionAttemptedCount: auth.selectionTrace.attemptedCount }
                  : null),
                ...(auth.selectionTrace.selectedIdentityKey
                  ? { selectionSelectedIdentityKey: auth.selectionTrace.selectedIdentityKey }
                  : null),
                ...(typeof auth.selectionTrace.selectedIndex === "number"
                  ? { selectionSelectedIndex: auth.selectionTrace.selectedIndex }
                  : null),
                ...(auth.selectionTrace.attemptKey ? { selectionAttemptKey: auth.selectionTrace.attemptKey } : null),
                ...(auth.selectionTrace.activeIdentityKey
                  ? { selectionActiveIdentityKey: auth.selectionTrace.activeIdentityKey }
                  : null),
                ...(auth.selectionTrace.sessionKey ? { selectionSessionKey: auth.selectionTrace.sessionKey } : null)
              }
            : null)
        })

        return payloadTransform.request
      },
      onAttemptResponse: async ({ attempt, maxAttempts, attemptReasonCode, response, auth, sessionKey }) => {
        await input.requestSnapshots.captureResponse("outbound-response", response, {
          attempt: attempt + 1,
          maxAttempts,
          attemptReasonCode,
          sessionKey,
          identityKey: auth.identityKey,
          accountLabel: auth.accountLabel
        })
      }
    })

    try {
      assertAllowedOutboundUrl(new URL(outbound.url))
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
      response = await orchestrator.execute(outbound)
    } catch (error) {
      if (isPluginFatalError(error)) {
        input.log?.debug("fatal auth/error response", {
          type: error.type,
          status: error.status
        })
        return toSyntheticErrorResponse(error)
      }

      input.log?.debug("unexpected fetch failure", {
        error: error instanceof Error ? error.message : String(error)
      })
      return toSyntheticErrorResponse(
        new PluginFatalError({
          message: "OpenAI request failed unexpectedly. Retry once, and if it persists run `opencode auth login`.",
          status: 502,
          type: "plugin_fetch_failed",
          param: "request"
        })
      )
    }

    persistRateLimitSnapshotFromResponse(response, selectedIdentityKey)

    const identityForQuota = selectedAuthForQuota?.identityKey
    if (identityForQuota && selectedAuthForQuota?.access) {
      pruneQuotaState(quotaRefreshAtByIdentity, quotaTrackerByIdentity, Date.now())
      scheduleQuotaRefresh({
        identityForQuota,
        selectedAuthForQuota: {
          access: selectedAuthForQuota.access,
          accountId: selectedAuthForQuota.accountId
        },
        spoofMode: input.spoofMode,
        log: input.log,
        quietMode: input.quietMode,
        quotaRefreshAtByIdentity,
        quotaTrackerByIdentity,
        setCooldown: input.setCooldown,
        showToast: input.showToast
      })
    }
    return response
  }
}
