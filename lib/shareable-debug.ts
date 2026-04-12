import { createHmac, randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import { enforceOwnerOnlyPermissions, isFsErrorCode } from "./cache-io.js"
import type { Logger } from "./logger.js"
import { defaultShareableDebugLogPath } from "./paths.js"
import type { RotationStrategy } from "./types.js"
import type { OpenAIAuthMode } from "./types.js"

const PROCESS_SECRET = randomBytes(32)

type ShareableDebugBaseEvent = {
  authMode: OpenAIAuthMode
}

export type ShareableDebugLogger = {
  enabled: boolean
  emitRotationBegin: (
    input: ShareableDebugBaseEvent & {
      rotationStrategy: RotationStrategy
      activeIdentityKey?: string
      sessionKey?: string | null
      totalAccounts: number
      enabledAccounts: number
    }
  ) => Promise<void>
  emitRotationDecision: (
    input: ShareableDebugBaseEvent & {
      rotationStrategy: RotationStrategy
      decision: string
      totalCount: number
      disabledCount: number
      cooldownCount: number
      refreshLeaseCount: number
      eligibleCount: number
      attemptedCount?: number
      selectedIdentityKey?: string
      activeIdentityKey?: string
      sessionKey?: string
      attemptKey?: string
      selectedIndex?: number
    }
  ) => Promise<void>
  emitRotationCandidateSelected: (
    input: ShareableDebugBaseEvent & {
      attemptKey?: string
      selectedIdentityKey?: string
      selectedIndex?: number
      selectedEnabled?: boolean
      selectedCooldownUntil?: number | null
      selectedExpires?: number | null
    }
  ) => Promise<void>
  emitFetchAttemptRequest: (
    input: ShareableDebugBaseEvent & {
      attempt: number
      maxAttempts: number
      attemptReasonCode: string
      request: Request
      selectedIdentityKey?: string
      activeIdentityKey?: string
      sessionKey?: string | null
      rotationStrategy?: string
    }
  ) => Promise<void>
  emitFetchAttemptResponse: (
    input: ShareableDebugBaseEvent & {
      attempt: number
      maxAttempts: number
      attemptReasonCode: string
      endpoint?: string
      status: number
      selectedIdentityKey?: string
      activeIdentityKey?: string
      sessionKey?: string | null
      rotationStrategy?: string
    }
  ) => Promise<void>
  emitRetryAfter429: (
    input: ShareableDebugBaseEvent & {
      attempt: number
      maxAttempts: number
      attemptReasonCode: string
      selectedIdentityKey?: string
      activeIdentityKey?: string
      sessionKey?: string | null
      rotationStrategy?: string
    }
  ) => Promise<void>
  emitAuthFailure: (
    input: ShareableDebugBaseEvent & {
      outcome: string
      status: number
      sessionKey?: string | null
      selectedIdentityKey?: string
      activeIdentityKey?: string
      waitMs?: number
    }
  ) => Promise<void>
}

function pseudonym(prefix: string, raw: string | undefined | null): string | undefined {
  const normalized = raw?.trim()
  if (!normalized) return undefined
  const digest = createHmac("sha256", PROCESS_SECRET).update(normalized).digest("hex").slice(0, 8)
  return `${prefix}_${digest}`
}

function normalizeEndpoint(input: string | undefined): string | undefined {
  if (!input) return undefined
  try {
    return new URL(input).pathname || undefined
  } catch {
    return undefined
  }
}

async function extractPromptCacheKey(request: Request): Promise<string | undefined> {
  try {
    const raw = await request.clone().text()
    if (!raw) return undefined

    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const candidate = (parsed as Record<string, unknown>).prompt_cache_key
        return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : undefined
      }
      return undefined
    } catch {
      const params = new URLSearchParams(raw)
      const candidate = params.get("prompt_cache_key")
      return candidate && candidate.trim().length > 0 ? candidate : undefined
    }
  } catch {
    return undefined
  }
}

function createNoopShareableDebugLogger(): ShareableDebugLogger {
  const noop = async () => {}
  return {
    enabled: false,
    emitRotationBegin: noop,
    emitRotationDecision: noop,
    emitRotationCandidateSelected: noop,
    emitFetchAttemptRequest: noop,
    emitFetchAttemptResponse: noop,
    emitRetryAfter429: noop,
    emitAuthFailure: noop
  }
}

export function createShareableDebugLogger(input: {
  enabled: boolean
  env?: Record<string, string | undefined>
  filePath?: string
  log?: Logger
}): ShareableDebugLogger {
  if (!input.enabled) return createNoopShareableDebugLogger()

  const filePath = input.filePath ?? defaultShareableDebugLogPath(input.env)
  let pendingWrite = Promise.resolve()

  const appendEvent = (event: string, payload: Record<string, unknown>): Promise<void> => {
    pendingWrite = pendingWrite
      .then(async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true })
        await fs.appendFile(
          filePath,
          `${JSON.stringify({ timestamp: new Date().toISOString(), event, ...payload })}\n`,
          {
            mode: 0o600
          }
        )
        await enforceOwnerOnlyPermissions(filePath)
      })
      .catch((error) => {
        input.log?.warn("shareable debug write failed", {
          error: error instanceof Error ? error.message : String(error)
        })
        if (isFsErrorCode(error, "ENOENT")) {
          return
        }
      })
    return pendingWrite
  }

  return {
    enabled: true,
    async emitRotationBegin(event) {
      await appendEvent("rotation_begin", {
        authMode: event.authMode,
        rotationStrategy: event.rotationStrategy,
        totalAccounts: event.totalAccounts,
        enabledAccounts: event.enabledAccounts,
        activeIdentity: pseudonym("ident", event.activeIdentityKey),
        session: pseudonym("sess", event.sessionKey)
      })
    },
    async emitRotationDecision(event) {
      await appendEvent("rotation_decision", {
        authMode: event.authMode,
        rotationStrategy: event.rotationStrategy,
        decision: event.decision,
        totalCount: event.totalCount,
        disabledCount: event.disabledCount,
        cooldownCount: event.cooldownCount,
        refreshLeaseCount: event.refreshLeaseCount,
        eligibleCount: event.eligibleCount,
        attemptedCount: event.attemptedCount,
        selectedIndex: event.selectedIndex,
        selectedIdentity: pseudonym("ident", event.selectedIdentityKey),
        activeIdentity: pseudonym("ident", event.activeIdentityKey),
        session: pseudonym("sess", event.sessionKey),
        attempt: pseudonym("attempt", event.attemptKey)
      })
    },
    async emitRotationCandidateSelected(event) {
      await appendEvent("rotation_candidate_selected", {
        authMode: event.authMode,
        selectedIndex: event.selectedIndex,
        selectedEnabled: event.selectedEnabled,
        selectedCooldownUntil: event.selectedCooldownUntil,
        selectedExpires: event.selectedExpires,
        selectedIdentity: pseudonym("ident", event.selectedIdentityKey),
        attempt: pseudonym("attempt", event.attemptKey)
      })
    },
    async emitFetchAttemptRequest(event) {
      await appendEvent("fetch_attempt_request", {
        authMode: event.authMode,
        rotationStrategy: event.rotationStrategy,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        attemptReasonCode: event.attemptReasonCode,
        method: event.request.method.toUpperCase(),
        endpoint: normalizeEndpoint(event.request.url),
        selectedIdentity: pseudonym("ident", event.selectedIdentityKey),
        activeIdentity: pseudonym("ident", event.activeIdentityKey),
        session: pseudonym("sess", event.sessionKey),
        promptCacheKey: pseudonym("pck", await extractPromptCacheKey(event.request))
      })
    },
    async emitFetchAttemptResponse(event) {
      await appendEvent("fetch_attempt_response", {
        authMode: event.authMode,
        rotationStrategy: event.rotationStrategy,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        attemptReasonCode: event.attemptReasonCode,
        endpoint: normalizeEndpoint(event.endpoint),
        status: event.status,
        selectedIdentity: pseudonym("ident", event.selectedIdentityKey),
        activeIdentity: pseudonym("ident", event.activeIdentityKey),
        session: pseudonym("sess", event.sessionKey)
      })
    },
    async emitRetryAfter429(event) {
      await appendEvent("retry_after_429", {
        authMode: event.authMode,
        rotationStrategy: event.rotationStrategy,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        attemptReasonCode: event.attemptReasonCode,
        selectedIdentity: pseudonym("ident", event.selectedIdentityKey),
        activeIdentity: pseudonym("ident", event.activeIdentityKey),
        session: pseudonym("sess", event.sessionKey)
      })
    },
    async emitAuthFailure(event) {
      await appendEvent("auth_failure", {
        authMode: event.authMode,
        outcome: event.outcome,
        status: event.status,
        waitMs: event.waitMs,
        selectedIdentity: pseudonym("ident", event.selectedIdentityKey),
        activeIdentity: pseudonym("ident", event.activeIdentityKey),
        session: pseudonym("sess", event.sessionKey)
      })
    }
  }
}
