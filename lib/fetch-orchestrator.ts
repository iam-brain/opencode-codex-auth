import { computeBackoffMs, parseRetryAfterMs } from "./rate-limit.js"
import { createSyntheticErrorResponse, formatWaitTime } from "./fatal-errors.js"
import {
  DEFAULT_ACCOUNT_SWITCH_TOAST_DEBOUNCE_MS,
  DEFAULT_RATE_LIMIT_TOAST_DEBOUNCE_MS,
  DEFAULT_SESSION_TOAST_DEBOUNCE_MS,
  formatAccountLabel,
  MAX_SESSION_KEYS,
  MAX_TOAST_DEDUPE_KEYS,
  resolveRetryAccountKey,
  resolveSessionKey,
  SESSION_KEY_TTL_MS,
  stripCrossOriginRedirectHeaders,
  TOAST_DEDUPE_TTL_MS
} from "./fetch-orchestrator-helpers.js"
import {
  createFetchOrchestratorState,
  type FetchAttemptReasonCode,
  type FetchOrchestratorDeps,
  type FetchOrchestratorState
} from "./fetch-orchestrator-types.js"

export {
  createFetchOrchestratorState,
  type AccountSelectionTrace,
  type AuthData,
  type FetchAttemptReasonCode,
  type FetchOrchestratorAuthContext,
  type FetchOrchestratorDeps,
  type FetchOrchestratorState
} from "./fetch-orchestrator-types.js"

export class FetchOrchestrator {
  private readonly state: FetchOrchestratorState

  constructor(private deps: FetchOrchestratorDeps) {
    this.state = deps.state ?? createFetchOrchestratorState()
  }

  private async fetchWithRedirectPolicy(request: Request): Promise<Response> {
    const maxRedirects = Math.max(0, Math.floor(this.deps.maxRedirects ?? 3))
    let current = request

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
      const response = await fetch(new Request(current, { redirect: "manual" }))
      if (response.status < 300 || response.status > 399) return response

      const location = response.headers.get("location")
      if (!location) return response

      if (redirectCount >= maxRedirects) {
        return createSyntheticErrorResponse(
          "Outbound request redirect limit exceeded.",
          502,
          "outbound_redirect_limit_exceeded",
          "request"
        )
      }

      const nextUrl = new URL(location, current.url)
      if (!this.deps.validateRedirectUrl) {
        return createSyntheticErrorResponse(
          "Blocked outbound redirect because redirect URL validation is not configured.",
          502,
          "blocked_outbound_redirect",
          "request"
        )
      }
      this.deps.validateRedirectUrl(nextUrl)

      const method = current.method.toUpperCase()
      if (method !== "GET" && method !== "HEAD") {
        return createSyntheticErrorResponse(
          "Blocked outbound redirect for non-idempotent request method.",
          502,
          "blocked_outbound_redirect",
          "request"
        )
      }

      const redirectHeaders = new Headers(current.headers)
      if (new URL(current.url).origin !== nextUrl.origin) {
        stripCrossOriginRedirectHeaders(redirectHeaders)
      }

      current = new Request(nextUrl.toString(), {
        method,
        headers: redirectHeaders,
        redirect: "manual"
      })
    }

    return createSyntheticErrorResponse(
      "Outbound request redirect handling failed.",
      502,
      "outbound_redirect_error",
      "request"
    )
  }

  private touchSessionKey(sessionKey: string, now: number, hasSeen: boolean = this.state.seenSessionKeys.has(sessionKey)): boolean {
    if (hasSeen) {
      this.state.seenSessionKeys.delete(sessionKey)
    }
    this.state.seenSessionKeys.set(sessionKey, now)
    this.enforceSessionKeyLimit()
    return hasSeen
  }

  private pruneSessionKeys(now: number): void {
    if (this.state.seenSessionKeys.size === 0) return
    const staleKeys: string[] = []
    for (const [key, lastSeen] of this.state.seenSessionKeys) {
      if (now - lastSeen > SESSION_KEY_TTL_MS) {
        staleKeys.push(key)
      }
    }
    for (const key of staleKeys) {
      this.state.seenSessionKeys.delete(key)
    }
  }

  private enforceSessionKeyLimit(): void {
    while (this.state.seenSessionKeys.size > MAX_SESSION_KEYS) {
      const oldest = this.state.seenSessionKeys.keys().next().value
      if (!oldest) break
      this.state.seenSessionKeys.delete(oldest)
    }
  }

  private shouldShowRateLimitToast(identityKey: string | undefined, now: number): boolean {
    this.pruneToastDedupeMap(this.state.rateLimitToastShownAt, now)
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
    this.pruneToastDedupeMap(this.state.toastShownAt, now)
    const normalizedDebounce = Math.max(0, Math.floor(debounceMs))
    const lastShownAt = this.state.toastShownAt.get(key)
    if (lastShownAt !== undefined && now - lastShownAt < normalizedDebounce) {
      return false
    }
    this.state.toastShownAt.set(key, now)
    return true
  }

  private pruneToastDedupeMap(map: Map<string, number>, now: number): void {
    const staleBefore = now - TOAST_DEDUPE_TTL_MS
    if (map.size > 0) {
      for (const [key, at] of map) {
        if (at < staleBefore) {
          map.delete(key)
        }
      }
    }
    while (map.size > MAX_TOAST_DEDUPE_KEYS) {
      const oldest = map.keys().next().value
      if (!oldest) break
      map.delete(oldest)
    }
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
    let sessionToastEventKey: string | null = null
    if (sessionKey) {
      const sessionNow = nowFn()
      const hasSeenBeforePrune = this.state.seenSessionKeys.has(sessionKey)
      this.pruneSessionKeys(sessionNow)
      const hadSessionHistory = hasSeenBeforePrune || this.state.seenSessionKeys.size > 0 || this.state.lastSessionKey !== null
      const hasSeen = this.touchSessionKey(sessionKey, sessionNow, hasSeenBeforePrune)
      const previousSessionKey = this.state.lastSessionKey
      if (!hasSeen && previousSessionKey && previousSessionKey !== sessionKey) {
        sessionEvent = "switch"
      } else if (!hasSeen && previousSessionKey === null && hadSessionHistory) {
        sessionEvent = "switch"
      } else if (!hasSeen) {
        sessionEvent = "new"
      } else if (previousSessionKey === sessionKey) {
        sessionEvent = "resume"
      } else if (previousSessionKey && previousSessionKey !== sessionKey) {
        sessionEvent = "switch"
      }
      this.state.lastSessionKey = sessionKey
      if (sessionEvent) {
        sessionToastEventKey = `${sessionEvent}:${sessionKey}`
      }
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
      const accountDisplayKey =
        auth.identityKey?.trim() || auth.accountId?.trim() || auth.email?.trim()?.toLowerCase() || accountLabel
      const retryAccountKey = resolveRetryAccountKey(auth)
      const attemptReasonCode: FetchAttemptReasonCode =
        attempt === 0 || previousAttemptStatus !== 429
          ? "initial_attempt"
          : previousAttemptAccountKey && retryAccountKey && previousAttemptAccountKey !== retryAccountKey
            ? "retry_switched_account_after_429"
            : "retry_same_account_after_429"

      const allowResumeToast =
        sessionEvent !== "resume" ||
        (this.state.lastSessionToastEventKey === null && this.state.lastAccountKey === null)
      if (
        sessionEvent &&
        allowResumeToast &&
        sessionToastEventKey &&
        !sessionToastEmitted &&
        this.state.lastSessionToastEventKey !== sessionToastEventKey
      ) {
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
        this.state.lastSessionToastEventKey = sessionToastEventKey
        sessionToastEmitted = true
      }

      if (this.state.lastAccountKey !== null && this.state.lastAccountKey !== accountDisplayKey) {
        const accountSwitchMessage =
          attemptReasonCode === "retry_switched_account_after_429"
            ? `Account switched after rate limit: ${accountLabel}`
            : `Account switched: ${accountLabel}`
        await this.maybeShowToast(accountSwitchMessage, "info", {
          dedupeKey: "account:switch",
          debounceMs: DEFAULT_ACCOUNT_SWITCH_TOAST_DEBOUNCE_MS,
          now
        })
      }
      this.state.lastAccountKey = accountDisplayKey

      let request = baseRequest.clone()
      request.headers.set("Authorization", `Bearer ${auth.access}`)
      request.headers.delete("ChatGPT-Account-Id")
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

      const response = await this.fetchWithRedirectPolicy(request)
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
      previousAttemptAccountKey = retryAccountKey

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
        try {
          await this.deps.setCooldown(auth.identityKey, cooldownUntil)
        } catch (error) {
          if (error instanceof Error) {
            // Cooldown persistence failures should not prevent retrying another account.
          }
          // Cooldown persistence failures should not prevent retrying another account.
        }
      }

      if (attempt < maxAttempts - 1 && this.shouldShowRateLimitToast(auth.identityKey, now)) {
        await this.maybeShowToast("Rate limited - switching account", "warning")
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

    if (lastResponse) {
      return lastResponse
    }

    return createSyntheticErrorResponse(
      "OpenAI request failed before receiving a response. Check connectivity and try again.",
      503,
      "upstream_unreachable",
      "network"
    )
  }
}
