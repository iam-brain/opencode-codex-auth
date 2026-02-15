import { FetchOrchestrator } from "../fetch-orchestrator"
import { PluginFatalError, isPluginFatalError, toSyntheticErrorResponse } from "../fatal-errors"
import type { Logger } from "../logger"
import type { CodexModelInfo } from "../model-catalog"
import type { RotationStrategy } from "../types"
import type { BehaviorSettings, CodexSpoofMode, PersonalityOption, PromptCacheKeyStrategy } from "../config"
import type { OpenAIAuthMode } from "../types"
import { acquireOpenAIAuth } from "./acquire-auth"
import { resolveRequestUserAgent } from "./client-identity"
import { resolveCodexOriginator } from "./originator"
import { buildProjectPromptCacheKey } from "../prompt-cache-key"
import { persistRateLimitSnapshotFromResponse } from "./rate-limit-snapshots"
import { assertAllowedOutboundUrl, rewriteUrl } from "./request-routing"
import { applyRequestTransformPipeline } from "./request-transform-pipeline"
import {
  applyPromptCacheKeyOverrideToRequest,
  sanitizeOutboundRequestIfNeeded,
  stripReasoningReplayFromRequest
} from "./request-transform"
import type { SessionAffinityRuntimeState } from "./session-affinity-state"

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
  requestSnapshots: SnapshotRecorder
  sessionAffinityState: SessionAffinityRuntimeState
  getCatalogModels: () => CodexModelInfo[] | undefined
  syncCatalogFromAuth: (auth: { accessToken?: string; accountId?: string }) => Promise<CodexModelInfo[] | undefined>
  setCooldown: (idKey: string, cooldownUntil: number) => Promise<void>
  showToast: (message: string, variant?: "info" | "success" | "warning" | "error", quietMode?: boolean) => Promise<void>
}

const MAX_INBOUND_USER_AGENT_LENGTH = 512

function isPrintableAscii(value: string): boolean {
  if (!value) return false
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code > 0x7e) return false
  }
  return true
}

function sanitizeInboundUserAgent(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (trimmed.length > MAX_INBOUND_USER_AGENT_LENGTH) return undefined
  return isPrintableAscii(trimmed) ? trimmed : undefined
}

export function createOpenAIFetchHandler(input: CreateOpenAIFetchHandlerInput) {
  return async (requestInput: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const baseRequest = new Request(requestInput, init)
    if (input.headerTransformDebug) {
      await input.requestSnapshots.captureRequest("before-header-transform", baseRequest, {
        spoofMode: input.spoofMode
      })
    }

    let outbound = new Request(rewriteUrl(baseRequest), baseRequest)
    const inboundOriginator = outbound.headers.get("originator")?.trim()
    const canPreserveInboundOriginator =
      (input.spoofMode === "native" && inboundOriginator === "opencode") ||
      (input.spoofMode !== "native" && (inboundOriginator === "codex_exec" || inboundOriginator === "codex_cli_rs"))
    const outboundOriginator =
      canPreserveInboundOriginator && inboundOriginator ? inboundOriginator : resolveCodexOriginator(input.spoofMode)
    outbound.headers.set("originator", outboundOriginator)

    const inboundUserAgent = sanitizeInboundUserAgent(outbound.headers.get("user-agent") ?? undefined)
    if (input.spoofMode === "native" && inboundUserAgent) {
      outbound.headers.set("user-agent", inboundUserAgent)
    } else {
      outbound.headers.set("user-agent", resolveRequestUserAgent(input.spoofMode, outboundOriginator))
    }

    if (outbound.headers.has(input.internalCollaborationModeHeader)) {
      outbound.headers.delete(input.internalCollaborationModeHeader)
    }

    const transformed = await applyRequestTransformPipeline({
      request: outbound,
      spoofMode: input.spoofMode,
      remapDeveloperMessagesToUserEnabled: input.remapDeveloperMessagesToUserEnabled,
      catalogModels: input.getCatalogModels(),
      behaviorSettings: input.behaviorSettings,
      fallbackPersonality: input.personality
    })
    outbound = transformed.request
    const isSubagentRequest = transformed.isSubagentRequest

    if (input.headerTransformDebug) {
      await input.requestSnapshots.captureRequest("after-header-transform", outbound, {
        spoofMode: input.spoofMode,
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

    const replaySanitized = await stripReasoningReplayFromRequest({
      request: outbound,
      enabled: true
    })
    outbound = replaySanitized.request
    if (replaySanitized.changed) {
      input.log?.debug("reasoning replay stripped", {
        removedPartCount: replaySanitized.removedPartCount,
        removedFieldCount: replaySanitized.removedFieldCount
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

        if (input.spoofMode === "codex") {
          const catalogModels = input.getCatalogModels()
          const shouldAwaitCatalog = !catalogModels || catalogModels.length === 0
          if (shouldAwaitCatalog) {
            try {
              await input.syncCatalogFromAuth({ accessToken: auth.access, accountId: auth.accountId })
            } catch {
              // best-effort catalog load; request can still proceed
            }
          } else {
            void input.syncCatalogFromAuth({ accessToken: auth.access, accountId: auth.accountId }).catch(() => {})
          }
        } else {
          void input.syncCatalogFromAuth({ accessToken: auth.access, accountId: auth.accountId }).catch(() => {})
        }

        selectedIdentityKey = auth.identityKey
        return auth
      },
      setCooldown: input.setCooldown,
      quietMode: input.quietMode,
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
      showToast: input.showToast,
      onAttemptRequest: async ({ attempt, maxAttempts, request, auth, sessionKey }) => {
        const transformed = await applyRequestTransformPipeline({
          request,
          spoofMode: input.spoofMode,
          remapDeveloperMessagesToUserEnabled: input.remapDeveloperMessagesToUserEnabled,
          catalogModels: input.getCatalogModels(),
          behaviorSettings: input.behaviorSettings,
          fallbackPersonality: input.personality
        })

        const promptCacheKeyStrategy = input.promptCacheKeyStrategy ?? "default"
        const promptCacheKeyOverride =
          promptCacheKeyStrategy === "project"
            ? await applyPromptCacheKeyOverrideToRequest({
                request: transformed.request,
                enabled: true,
                promptCacheKey: buildProjectPromptCacheKey({
                  projectPath: input.projectPath ?? process.cwd(),
                  spoofMode: input.spoofMode
                })
              })
            : {
                request: transformed.request,
                changed: false,
                reason: "default_strategy"
              }

        await input.requestSnapshots.captureRequest("outbound-attempt", promptCacheKeyOverride.request, {
          attempt: attempt + 1,
          maxAttempts,
          hasSessionKey: Boolean(sessionKey),
          hasIdentityKey: Boolean(auth.identityKey),
          hasAccountLabel: Boolean(auth.accountLabel),
          instructionsOverridden: transformed.instructionOverride.changed,
          instructionOverrideReason: transformed.instructionOverride.reason,
          developerMessagesRemapped: transformed.developerRoleRemap.changed,
          developerMessageRemapReason: transformed.developerRoleRemap.reason,
          developerMessageRemapCount: transformed.developerRoleRemap.remappedCount,
          developerMessagePreservedCount: transformed.developerRoleRemap.preservedCount,
          promptCacheKeyOverridden: promptCacheKeyOverride.changed,
          promptCacheKeyOverrideReason: promptCacheKeyOverride.reason
        })

        return promptCacheKeyOverride.request
      },
      onAttemptResponse: async ({ attempt, maxAttempts, response, auth, sessionKey }) => {
        await input.requestSnapshots.captureResponse("outbound-response", response, {
          attempt: attempt + 1,
          maxAttempts,
          hasSessionKey: Boolean(sessionKey),
          hasIdentityKey: Boolean(auth.identityKey),
          hasAccountLabel: Boolean(auth.accountLabel)
        })
      }
    })

    const sanitizedOutbound = await sanitizeOutboundRequestIfNeeded(outbound, input.compatInputSanitizerEnabled)
    if (sanitizedOutbound.changed) {
      input.log?.debug("compat input sanitizer applied", { mode: input.spoofMode })
    }

    await input.requestSnapshots.captureRequest("after-sanitize", sanitizedOutbound.request, {
      spoofMode: input.spoofMode,
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
    return response
  }
}
