import { computeBackoffMs, parseRetryAfterMs } from "./rate-limit"
import { createSyntheticErrorResponse, formatWaitTime } from "./fatal-errors"

export type AccountSelectionTrace = {
  strategy: string
  decision: string
  totalCount: number
  disabledCount: number
  cooldownCount: number
  refreshLeaseCount: number
  eligibleCount: number
  attemptedCount?: number
  selectedIdentityKey?: string
  selectedIndex?: number
  attemptKey?: string
  activeIdentityKey?: string
  sessionKey?: string
}

export type AuthData = {
  access: string
  accountId?: string
  identityKey?: string
  email?: string
  plan?: string
  accountLabel?: string
  selectionTrace?: AccountSelectionTrace
}

export type FetchOrchestratorAuthContext = {
  sessionKey: string | null
}

export type FetchOrchestratorState = {
  lastSessionKey: string | null
  seenSessionKeys: Map<string, number>
  lastAccountKey: string | null
  rateLimitToastShownAt: Map<string, number>
  toastShownAt: Map<string, number>
}

export type FetchAttemptReasonCode =
  | "initial_attempt"
  | "retry_same_account_after_429"
  | "retry_switched_account_after_429"

export function createFetchOrchestratorState(): FetchOrchestratorState {
  return {
    lastSessionKey: null,
    seenSessionKeys: new Map<string, number>(),
    lastAccountKey: null,
    rateLimitToastShownAt: new Map<string, number>(),
    toastShownAt: new Map<string, number>()
  }
}

export type FetchOrchestratorDeps = {
  acquireAuth: (context?: FetchOrchestratorAuthContext) => Promise<AuthData>
  setCooldown: (identityKey: string, cooldownUntil: number) => Promise<void>
  now?: () => number
  maxAttempts?: number
  quietMode?: boolean
  rateLimitToastDebounceMs?: number
  state?: FetchOrchestratorState
  showToast?: (message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>
  onAttemptRequest?: (input: {
    attempt: number
    maxAttempts: number
    attemptReasonCode: FetchAttemptReasonCode
    request: Request
    auth: AuthData
    sessionKey: string | null
  }) => Promise<Request | void> | Request | void
  onAttemptResponse?: (input: {
    attempt: number
    maxAttempts: number
    attemptReasonCode: FetchAttemptReasonCode
    response: Response
    auth: AuthData
    sessionKey: string | null
  }) => Promise<void> | void
  onSessionObserved?: (input: {
    sessionKey: string
    now: number
    event: "new" | "resume" | "switch" | "seen"
  }) => Promise<void> | void
}

const SESSION_KEY_TTL_MS = 6 * 60 * 60 * 1000
const MAX_SESSION_KEYS = 200
const DEFAULT_RATE_LIMIT_TOAST_DEBOUNCE_MS = 60_000
const DEFAULT_SESSION_TOAST_DEBOUNCE_MS = 15_000
const DEFAULT_ACCOUNT_SWITCH_TOAST_DEBOUNCE_MS = 15_000

function normalizeSessionKey(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

async function resolveSessionKey(request: Request): Promise<string | null> {
  return normalizeSessionKey(request.headers.get("session_id"))
}

function formatAccountLabel(auth: AuthData): string {
  const explicit = auth.accountLabel?.trim()
  if (explicit) return explicit

  const email = auth.email?.trim()
  const plan = auth.plan?.trim()
  const accountId = auth.accountId?.trim()
  const idSuffix = accountId ? (accountId.length > 6 ? accountId.slice(-6) : accountId) : undefined

  if (email && plan) return `${email} (${plan})`
  if (email) return email
  if (idSuffix) return `id:${idSuffix}`
  return "account"
}

export class FetchOrchestrator {
  private readonly state: FetchOrchestratorState

  constructor(private deps: FetchOrchestratorDeps) {
    this.state = deps.state ?? createFetchOrchestratorState()
  }

  private touchSessionKey(sessionKey: string, now: number): boolean {
    this.pruneSessionKeys(now)
    const hasSeen = this.state.seenSessionKeys.has(sessionKey)
    if (hasSeen) {
      this.state.seenSessionKeys.delete(sessionKey)
    }
    this.state.seenSessionKeys.set(sessionKey, now)
    this.enforceSessionKeyLimit()
    return hasSeen
  }

  private pruneSessionKeys(now: number): void {
    if (this.state.seenSessionKeys.size === 0) return
    for (const [key, lastSeen] of this.state.seenSessionKeys) {
      if (now - lastSeen > SESSION_KEY_TTL_MS) {
        this.state.seenSessionKeys.delete(key)
      }
    }
  }

  private enforceSessionKeyLimit(): void {
    while (this.state.seenSessionKeys.size > MAX_SESSION_KEYS) {
      const oldest = this.state.seenSessionKeys.keys().next().value as string | undefined
      if (!oldest) break
      this.state.seenSessionKeys.delete(oldest)
    }
  }

  private shouldShowRateLimitToast(identityKey: string | undefined, now: number): boolean {
    const key = identityKey ?? "__global__"
    const debounceMs = Math.max(
      0,
      Math.floor(this.deps.rateLimitToastDebounceMs ?? DEFAULT_RATE_LIMIT_TOAST_DEBOUNCE_MS)
    )
    const lastShownAt = this.state.rateLimitToastShownAt.get(key)
    if (lastShownAt !== undefined && now - lastShownAt < debounceMs) {
      return false
    }
    this.state.rateLimitToastShownAt.set(key, now)
    return true
  }

  private shouldShowToastByKey(key: string, now: number, debounceMs: number): boolean {
    const normalizedDebounce = Math.max(0, Math.floor(debounceMs))
    const lastShownAt = this.state.toastShownAt.get(key)
    if (lastShownAt !== undefined && now - lastShownAt < normalizedDebounce) {
      return false
    }
    this.state.toastShownAt.set(key, now)
    return true
  }

  private async maybeShowToast(
    message: string,
    variant: "info" | "success" | "warning" | "error",
    options?: {
      dedupeKey?: string
      debounceMs?: number
      now?: number
    }
  ): Promise<void> {
    if (!this.deps.showToast) return
    if (options?.dedupeKey) {
      const now = options.now ?? (this.deps.now ?? Date.now)()
      if (!this.shouldShowToastByKey(options.dedupeKey, now, options.debounceMs ?? 0)) {
        return
      }
    }
    try {
      await this.deps.showToast(message, variant, this.deps.quietMode === true)
    } catch (error) {
      if (error instanceof Error) {
        // Toast failures should never block request execution.
      }
      // Toast failures should never block request execution.
    }
  }

  async execute(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const requestedAttempts = this.deps.maxAttempts ?? 3
    const finiteAttempts = Number.isFinite(requestedAttempts) ? requestedAttempts : 3
    const maxAttempts = Math.max(1, Math.floor(finiteAttempts))
    const nowFn = this.deps.now ?? Date.now

    const baseRequest = new Request(input, init)
    const sessionKey = await resolveSessionKey(baseRequest)
    let sessionEvent: "new" | "resume" | "switch" | null = null
    if (sessionKey) {
      const sessionNow = nowFn()
      const hasSeen = this.touchSessionKey(sessionKey, sessionNow)
      if (!hasSeen) {
        sessionEvent = "new"
      } else if (!this.state.lastSessionKey) {
        sessionEvent = "resume"
      } else if (this.state.lastSessionKey && this.state.lastSessionKey !== sessionKey) {
        sessionEvent = "switch"
      }
      this.state.lastSessionKey = sessionKey
      if (this.deps.onSessionObserved) {
        try {
          await this.deps.onSessionObserved({
            sessionKey,
            now: sessionNow,
            event: sessionEvent ?? "seen"
          })
        } catch (error) {
          if (error instanceof Error) {
            // Session persistence hooks should never block request execution.
          }
          // Session persistence hooks should never block request execution.
        }
      }
    }
    let sessionToastEmitted = false
    let lastResponse: Response | undefined
    let previousAttemptStatus: number | null = null
    let previousAttemptAccountKey: string | null = null

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const now = nowFn()
      const auth = await this.deps.acquireAuth({ sessionKey })
      const accountLabel = formatAccountLabel(auth)
      const accountKey =
        auth.identityKey?.trim() || auth.accountId?.trim() || auth.email?.trim()?.toLowerCase() || accountLabel
      const attemptReasonCode: FetchAttemptReasonCode =
        attempt === 0 || previousAttemptStatus !== 429
          ? "initial_attempt"
          : previousAttemptAccountKey && previousAttemptAccountKey !== accountKey
            ? "retry_switched_account_after_429"
            : "retry_same_account_after_429"

      if (sessionEvent && !sessionToastEmitted) {
        const message =
          sessionEvent === "new"
            ? `New chat: ${accountLabel}`
            : sessionEvent === "resume"
              ? `Resuming chat: ${accountLabel}`
              : `Session switched: ${accountLabel}`
        await this.maybeShowToast(message, "info", {
          dedupeKey: `session:${sessionEvent}`,
          debounceMs: DEFAULT_SESSION_TOAST_DEBOUNCE_MS,
          now
        })
        sessionToastEmitted = true
      }

      if (this.state.lastAccountKey !== null && this.state.lastAccountKey !== accountKey) {
        const accountSwitchMessage =
          attemptReasonCode === "retry_switched_account_after_429"
            ? `Account switched after rate limit: ${accountLabel} [${attemptReasonCode}]`
            : `Account switched: ${accountLabel}`
        await this.maybeShowToast(accountSwitchMessage, "info", {
          dedupeKey: "account:switch",
          debounceMs: DEFAULT_ACCOUNT_SWITCH_TOAST_DEBOUNCE_MS,
          now
        })
      }
      this.state.lastAccountKey = accountKey

      let request = baseRequest.clone()
      request.headers.set("Authorization", `Bearer ${auth.access}`)
      if (auth.accountId) {
        request.headers.set("ChatGPT-Account-Id", auth.accountId)
      }
      if (this.deps.onAttemptRequest) {
        try {
          const maybeRequest = await this.deps.onAttemptRequest({
            attempt,
            maxAttempts,
            attemptReasonCode,
            request,
            auth,
            sessionKey
          })
          if (maybeRequest instanceof Request) {
            request = maybeRequest
          }
        } catch (error) {
          if (error instanceof Error) {
            // Snapshot/debug hooks should never block request execution.
          }
          // Snapshot/debug hooks should never block request execution.
        }
      }

      const response = await fetch(request)
      if (this.deps.onAttemptResponse) {
        try {
          await this.deps.onAttemptResponse({
            attempt,
            maxAttempts,
            attemptReasonCode,
            response: response.clone(),
            auth,
            sessionKey
          })
        } catch (error) {
          if (error instanceof Error) {
            // Snapshot/debug hooks should never block request execution.
          }
          // Snapshot/debug hooks should never block request execution.
        }
      }
      if (response.status !== 429) {
        return response
      }

      lastResponse = response
      previousAttemptStatus = response.status
      previousAttemptAccountKey = accountKey

      // Handle 429
      const retryAfterStr = response.headers.get("retry-after")
      if (auth.identityKey) {
        const headerMap = { "retry-after": retryAfterStr ?? undefined }
        const retryAfterMs = parseRetryAfterMs(headerMap, now)
        const fallbackMs = computeBackoffMs({
          attempt,
          baseMs: 5000,
          maxMs: 5000,
          jitterMaxMs: 0
        })
        const cooldownUntil = now + (retryAfterMs ?? fallbackMs)
        await this.deps.setCooldown(auth.identityKey, cooldownUntil)
      }

      if (attempt < maxAttempts - 1 && this.shouldShowRateLimitToast(auth.identityKey, now)) {
        await this.maybeShowToast("Rate limited - switching account [retry_pending_after_429]", "warning")
      }
    }

    if (lastResponse?.status === 429) {
      const retryAfterRaw = lastResponse.headers.get("retry-after")
      const retryAfterMs = parseRetryAfterMs({ "retry-after": retryAfterRaw ?? undefined }, nowFn())
      const waitLabel = typeof retryAfterMs === "number" ? formatWaitTime(retryAfterMs) : "a short while"
      return createSyntheticErrorResponse(
        `All attempted OpenAI accounts are rate limited. Try again in ${waitLabel} or run \`opencode auth login\` to add another account.`,
        429,
        "all_accounts_rate_limited",
        "accounts"
      )
    }

    return lastResponse!
  }
}
