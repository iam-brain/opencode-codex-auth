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
import { applyRequestTransformPipeline } from "./request-transform-pipeline.js"
import { type OutboundRequestPayloadTransformResult, transformOutboundRequestPayload } from "./request-transform.js"
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
  internalCollaborationModeHeader: string
  internalCollaborationAgentHeader?: string
  requestSnapshots: SnapshotRecorder
  sessionAffinityState: SessionAffinityRuntimeState
  getCatalogModels: () => CodexModelInfo[] | undefined
  syncCatalogFromAuth: (auth: { accessToken?: string; accountId?: string }) => Promise<CodexModelInfo[] | undefined>
  setCooldown: (idKey: string, cooldownUntil: number) => Promise<void>
  showToast: (message: string, variant?: "info" | "success" | "warning" | "error", quietMode?: boolean) => Promise<void>
}

export function createOpenAIFetchHandler(input: CreateOpenAIFetchHandlerInput) {
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
    const collaborationAgentKind = outbound.headers.get(internalCollaborationAgentHeader)?.trim() || undefined
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

    const transformed = await applyRequestTransformPipeline({
      request: outbound,
      spoofMode: input.spoofMode,
      remapDeveloperMessagesToUserEnabled: input.remapDeveloperMessagesToUserEnabled,
      catalogModels: input.getCatalogModels(),
      behaviorSettings: input.behaviorSettings,
      fallbackPersonality: input.personality,
      preserveOrchestratorInstructions: collaborationAgentKind === "orchestrator",
      replaceCodexToolCalls: input.spoofMode === "codex"
    })
    outbound = transformed.request
    const isSubagentRequest = transformed.isSubagentRequest

    let selectedIdentityKey: string | undefined
    let selectedAuthForQuota: { access: string; accountId?: string; identityKey?: string } | undefined

    const promptCacheKeyStrategy = input.promptCacheKeyStrategy ?? "default"
    const promptCacheKeyOverride =
      promptCacheKeyStrategy === "project"
        ? buildProjectPromptCacheKey({
            projectPath: input.projectPath ?? process.cwd(),
            spoofMode: input.spoofMode
          })
        : undefined

    const initialPayloadTransform: OutboundRequestPayloadTransformResult = await transformOutboundRequestPayload({
      request: outbound,
      stripReasoningReplayEnabled: true,
      remapDeveloperMessagesToUserEnabled: input.remapDeveloperMessagesToUserEnabled,
      compatInputSanitizerEnabled: input.compatInputSanitizerEnabled,
      promptCacheKeyOverrideEnabled: promptCacheKeyStrategy === "project",
      promptCacheKeyOverride
    })
    outbound = initialPayloadTransform.request

    if (input.headerTransformDebug) {
      await input.requestSnapshots.captureRequest("after-header-transform", outbound, {
        spoofMode: input.spoofMode,
        instructionsOverridden: transformed.instructionOverride.changed,
        instructionOverrideReason: transformed.instructionOverride.reason,
        developerMessagesRemapped: initialPayloadTransform.developerRoleRemap.changed,
        developerMessageRemapReason: initialPayloadTransform.developerRoleRemap.reason,
        developerMessageRemapCount: initialPayloadTransform.developerRoleRemap.remappedCount,
        developerMessagePreservedCount: initialPayloadTransform.developerRoleRemap.preservedCount,
        ...(isSubagentRequest ? { subagent: transformed.subagentHeader } : {})
      })
    }

    if (initialPayloadTransform.replay.changed) {
      input.log?.debug("reasoning replay stripped", {
        removedPartCount: initialPayloadTransform.replay.removedPartCount,
        removedFieldCount: initialPayloadTransform.replay.removedFieldCount
      })
    }

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
        const currentCatalog = input.getCatalogModels()
        const shouldAwaitCatalog = input.spoofMode === "codex" && (!currentCatalog || currentCatalog.length === 0)
        const catalogScopeKey = resolveCatalogScopeKey(auth)
        const catalogSyncState = getCatalogSyncState(catalogSyncByScope, catalogScopeKey)
        const refreshRetryMs =
          catalogSyncState.lastFailureAt > 0 ? CATALOG_REFRESH_FAILURE_RETRY_MS : CATALOG_REFRESH_TTL_MS
        const shouldRefreshCatalog =
          catalogSyncState.lastAttemptAt === 0 || now - catalogSyncState.lastAttemptAt >= refreshRetryMs

        if (shouldRefreshCatalog) {
          if (!catalogSyncState.inFlight) {
            catalogSyncState.lastAttemptAt = now
            const syncPromise = input
              .syncCatalogFromAuth({ accessToken: auth.access, accountId: auth.accountId })
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
        await input.requestSnapshots.captureRequest("outbound-attempt", request, {
          attempt: attempt + 1,
          maxAttempts,
          attemptReasonCode,
          sessionKey,
          identityKey: auth.identityKey,
          accountLabel: auth.accountLabel,
          instructionsOverridden: transformed.instructionOverride.changed,
          instructionOverrideReason: transformed.instructionOverride.reason,
          developerMessagesRemapped: initialPayloadTransform.developerRoleRemap.changed,
          developerMessageRemapReason: initialPayloadTransform.developerRoleRemap.reason,
          developerMessageRemapCount: initialPayloadTransform.developerRoleRemap.remappedCount,
          developerMessagePreservedCount: initialPayloadTransform.developerRoleRemap.preservedCount,
          promptCacheKeyOverridden: initialPayloadTransform.promptCacheKey.changed,
          promptCacheKeyOverrideReason:
            promptCacheKeyStrategy === "project" ? initialPayloadTransform.promptCacheKey.reason : "default_strategy",
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

        return request
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

    if (initialPayloadTransform.compatSanitizer.changed) {
      input.log?.debug("compat input sanitizer applied", { mode: input.spoofMode })
    }

    await input.requestSnapshots.captureRequest("after-sanitize", initialPayloadTransform.request, {
      spoofMode: input.spoofMode,
      sanitized: initialPayloadTransform.compatSanitizer.changed
    })

    try {
      assertAllowedOutboundUrl(new URL(initialPayloadTransform.request.url))
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
      response = await orchestrator.execute(initialPayloadTransform.request)
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
