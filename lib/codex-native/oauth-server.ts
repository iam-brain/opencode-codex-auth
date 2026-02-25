import http from "node:http"
import path from "node:path"
import { appendFileSync, chmodSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs"

import type { OpenAIAuthMode } from "../types.js"
import { isFsErrorCode } from "../cache-io.js"
import { defaultCodexPluginLogsPath } from "../paths.js"

type OAuthServerStopReason = "success" | "error" | "other"

type OAuthServerControllerInput<TPkce, TTokens> = {
  port: number
  loopbackHost: string
  callbackOrigin: string
  callbackUri: string
  callbackPath: string
  callbackTimeoutMs: number
  debugLogDir?: string
  debugLogFile?: string
  buildOAuthErrorHtml: (error: string) => string
  buildOAuthSuccessHtml: (mode: "native" | "codex") => string
  composeCodexSuccessRedirectUrl: (tokens: TTokens) => string
  exchangeCodeForTokens: (code: string, redirectUri: string, pkce: TPkce) => Promise<TTokens>
}

type PendingOAuth<TPkce, TTokens> = {
  pkce: TPkce
  state: string
  authMode: OpenAIAuthMode
  resolve: (tokens: TTokens) => void
  reject: (error: Error) => void
}

const DEFAULT_DEBUG_LOG_MAX_BYTES = 1_000_000
const REDACTED = "[redacted]"
const REDACTED_DEBUG_META_KEY_FRAGMENTS = [
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
  "id_token",
  "refresh_token",
  "access_token",
  "authorization_code",
  "auth_code",
  "code_verifier",
  "pkce",
  "verifier"
]

function shouldRedactDebugMetaKey(key: string): boolean {
  const lower = key.trim().toLowerCase()
  if (!lower) return false
  return REDACTED_DEBUG_META_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment))
}

function sanitizeDebugMeta(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(
        /\b(access_token|refresh_token|id_token|authorization_code|auth_code|code_verifier|pkce_verifier)=([^\s&]+)/gi,
        `$1=${REDACTED}`
      )
      .replace(
        /"(access_token|refresh_token|id_token|authorization_code|auth_code|code_verifier|pkce_verifier)"\s*:\s*"[^"]*"/gi,
        `"$1":"${REDACTED}"`
      )
      .replace(
        /([?&])(code|state|access_token|refresh_token|id_token|code_verifier|pkce_verifier)=([^&]+)/gi,
        (_match, prefix, key) => {
          return `${prefix}${key}=${REDACTED}`
        }
      )
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeDebugMeta(item))
  if (!value || typeof value !== "object") return value

  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = shouldRedactDebugMetaKey(key) ? REDACTED : sanitizeDebugMeta(entry)
  }
  return out
}

function resolveDebugLogMaxBytes(): number {
  const raw = process.env.CODEX_AUTH_DEBUG_MAX_BYTES
  if (!raw) return DEFAULT_DEBUG_LOG_MAX_BYTES
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_DEBUG_LOG_MAX_BYTES
  return Math.max(16_384, Math.floor(parsed))
}

function rotateDebugLogIfNeeded(debugLogFile: string, maxBytes: number): void {
  try {
    const stat = statSync(debugLogFile)
    if (stat.size < maxBytes) return
    const rotatedPath = `${debugLogFile}.1`
    try {
      unlinkSync(rotatedPath)
    } catch (error) {
      if (!isFsErrorCode(error, "ENOENT")) {
        // ignore missing previous rotation file
      }
      // ignore missing previous rotation file
    }
    renameSync(debugLogFile, rotatedPath)
  } catch (error) {
    if (!isFsErrorCode(error, "ENOENT")) {
      // ignore when file does not exist or cannot be inspected
    }
    // ignore when file does not exist or cannot be inspected
  }
}

export function createOAuthServerController<TPkce, TTokens>(
  input: OAuthServerControllerInput<TPkce, TTokens>
): {
  isDebugEnabled: () => boolean
  emitDebug: (event: string, meta?: Record<string, unknown>) => void
  start: () => Promise<{ redirectUri: string }>
  stop: () => void
  scheduleStop: (delayMs: number, reason: OAuthServerStopReason) => void
  waitForCallback: (pkce: TPkce, state: string, authMode: OpenAIAuthMode) => Promise<TTokens>
} {
  const debugLogDir = input.debugLogDir ?? defaultCodexPluginLogsPath()
  const debugLogFile = input.debugLogFile ?? path.join(debugLogDir, "oauth-lifecycle.log")
  const debugLogMaxBytes = resolveDebugLogMaxBytes()

  let oauthServer: http.Server | undefined
  let pendingOAuth: PendingOAuth<TPkce, TTokens> | undefined
  let lastErrorState: string | undefined
  let oauthServerCloseTimer: ReturnType<typeof setTimeout> | undefined

  function isDebugEnabled(): boolean {
    const raw = process.env.CODEX_AUTH_DEBUG?.trim().toLowerCase()
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
  }

  function emitDebug(event: string, meta: Record<string, unknown> = {}): void {
    if (!isDebugEnabled()) return
    const sanitizedMeta = (sanitizeDebugMeta(meta) as Record<string, unknown>) ?? {}
    const payload: Record<string, unknown> = {
      ts: new Date().toISOString(),
      pid: process.pid,
      event,
      meta: sanitizedMeta
    }
    const line = JSON.stringify(payload)
    try {
      console.error(`[codex-auth-debug] ${line}`)
    } catch (error) {
      if (error instanceof Error) {
        // best effort stderr logging
      }
      // best effort stderr logging
    }
    try {
      mkdirSync(debugLogDir, { recursive: true, mode: 0o700 })
      rotateDebugLogIfNeeded(debugLogFile, debugLogMaxBytes)
      appendFileSync(debugLogFile, `${line}\n`, { encoding: "utf8", mode: 0o600 })
      chmodSync(debugLogFile, 0o600)
    } catch (error) {
      if (error instanceof Error) {
        // best effort file logging
      }
      // best effort file logging
    }
  }

  function clearCloseTimer(): void {
    if (!oauthServerCloseTimer) return
    clearTimeout(oauthServerCloseTimer)
    oauthServerCloseTimer = undefined
  }

function isLoopbackRemoteAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false
  const normalized = remoteAddress.split("%")[0]?.toLowerCase()
  if (!normalized) return false
  if (normalized === "::1") return true
  if (normalized.startsWith("127.")) return true
  if (normalized.startsWith("::ffff:127.")) return true
  return false
}

  function setResponseHeaders(res: http.ServerResponse, options?: { contentType?: string; isHtml?: boolean }): void {
    res.setHeader("Cache-Control", "no-store")
    res.setHeader("Pragma", "no-cache")
    res.setHeader("Referrer-Policy", "no-referrer")
    res.setHeader("X-Content-Type-Options", "nosniff")
    if (options?.contentType) {
      res.setHeader("Content-Type", options.contentType)
    }
    if (options?.isHtml) {
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      )
    }
  }

  async function start(): Promise<{ redirectUri: string }> {
    clearCloseTimer()
    if (oauthServer) {
      emitDebug("server_reuse", { port: input.port })
      return { redirectUri: input.callbackUri }
    }

    emitDebug("server_starting", { port: input.port })
    oauthServer = http.createServer((req, res) => {
      try {
        if (!isLoopbackRemoteAddress(req.socket.remoteAddress)) {
          emitDebug("callback_rejected_non_loopback", {
            remoteAddress: req.socket.remoteAddress
          })
          res.statusCode = 403
          setResponseHeaders(res, { contentType: "text/plain; charset=utf-8" })
          res.end("Forbidden")
          return
        }

        const url = new URL(req.url ?? "/", input.callbackOrigin)

        const sendHtml = (status: number, html: string) => {
          res.statusCode = status
          setResponseHeaders(res, { contentType: "text/html; charset=utf-8", isHtml: true })
          res.end(html)
        }
        const redirect = (location: string) => {
          res.statusCode = 302
          setResponseHeaders(res, { contentType: "text/plain; charset=utf-8" })
          res.setHeader("Location", location)
          res.end()
        }

        if (url.pathname === input.callbackPath) {
          const code = url.searchParams.get("code")
          const state = url.searchParams.get("state")
          const error = url.searchParams.get("error")
          const errorDescription = url.searchParams.get("error_description")
          emitDebug("callback_hit", {
            hasCode: Boolean(code),
            hasState: Boolean(state),
            hasError: Boolean(error)
          })

          if (!pendingOAuth || state !== pendingOAuth.state) {
            if (error && state && state === lastErrorState) {
              const errorMsg = errorDescription || error
              emitDebug("callback_error", { reason: errorMsg })
              sendHtml(200, input.buildOAuthErrorHtml(errorMsg))
              return
            }
            const errorMsg = "Invalid state - potential CSRF attack"
            emitDebug("callback_error", { reason: errorMsg })
            sendHtml(400, input.buildOAuthErrorHtml(errorMsg))
            return
          }

          const current = pendingOAuth

          if (error) {
            const errorMsg = errorDescription || error
            emitDebug("callback_error", { reason: errorMsg })
            current.reject(new Error(errorMsg))
            lastErrorState = state ?? undefined
            pendingOAuth = undefined
            sendHtml(200, input.buildOAuthErrorHtml(errorMsg))
            return
          }

          if (!code) {
            const errorMsg = "Missing authorization code"
            emitDebug("callback_error", { reason: errorMsg })
            current.reject(new Error(errorMsg))
            pendingOAuth = undefined
            sendHtml(400, input.buildOAuthErrorHtml(errorMsg))
            return
          }

          pendingOAuth = undefined
          lastErrorState = undefined
          emitDebug("token_exchange_start", { authMode: current.authMode })
          input
            .exchangeCodeForTokens(code, input.callbackUri, current.pkce)
            .then((tokens) => {
              current.resolve(tokens)
              emitDebug("token_exchange_success", { authMode: current.authMode })
              if (res.writableEnded) return
              if (current.authMode === "codex") {
                redirect(input.composeCodexSuccessRedirectUrl(tokens))
                return
              }
              sendHtml(200, input.buildOAuthSuccessHtml("native"))
            })
            .catch((err) => {
              const oauthError = err instanceof Error ? err : new Error(String(err))
              current.reject(oauthError)
              emitDebug("token_exchange_error", { error: oauthError.message })
              if (res.writableEnded) return
              sendHtml(500, input.buildOAuthErrorHtml("OAuth token exchange failed"))
            })
          return
        }

        if (url.pathname === "/success") {
          emitDebug("callback_success_page")
          sendHtml(200, input.buildOAuthSuccessHtml("codex"))
          return
        }

        if (url.pathname === "/cancel") {
          const state = url.searchParams.get("state")
          if (!pendingOAuth || !state || state !== pendingOAuth.state) {
            emitDebug("callback_cancel_rejected", {
              hasPendingOAuth: Boolean(pendingOAuth),
              hasState: Boolean(state),
              stateMatches: Boolean(state) && state === pendingOAuth?.state
            })
            res.statusCode = 400
            setResponseHeaders(res, { contentType: "text/plain; charset=utf-8" })
            res.end("Invalid cancel state")
            return
          }

          emitDebug("callback_cancel")
          pendingOAuth.reject(new Error("Login cancelled"))
          pendingOAuth = undefined
          res.statusCode = 200
          setResponseHeaders(res, { contentType: "text/plain; charset=utf-8" })
          res.end("Login cancelled")
          return
        }

        res.statusCode = 404
        setResponseHeaders(res, { contentType: "text/plain; charset=utf-8" })
        res.end("Not found")
      } catch (error) {
        res.statusCode = 500
        setResponseHeaders(res, { contentType: "text/plain; charset=utf-8" })
        res.end("Server error")
      }
    })

    try {
      await new Promise<void>((resolve, reject) => {
        oauthServer?.once("error", reject)
        oauthServer?.listen(input.port, input.loopbackHost, () => resolve())
      })
      emitDebug("server_started", { port: input.port })
    } catch (error) {
      emitDebug("server_start_error", {
        error: error instanceof Error ? error.message : String(error)
      })
      const server = oauthServer
      oauthServer = undefined
      try {
        server?.close()
      } catch (error) {
        if (error instanceof Error) {
          // best-effort cleanup
        }
        // best-effort cleanup
      }
      throw error
    }

    return { redirectUri: input.callbackUri }
  }

  function stop(): void {
    clearCloseTimer()
    emitDebug("server_stopping", { hadPendingOAuth: Boolean(pendingOAuth) })
    oauthServer?.close()
    oauthServer = undefined
    lastErrorState = undefined
    emitDebug("server_stopped")
  }

  function scheduleStop(delayMs: number, reason: OAuthServerStopReason): void {
    if (!oauthServer) return
    clearCloseTimer()
    emitDebug("server_stop_scheduled", { delayMs, reason })
    oauthServerCloseTimer = setTimeout(() => {
      oauthServerCloseTimer = undefined
      if (pendingOAuth) return
      emitDebug("server_stop_timer_fired", { reason })
      stop()
    }, delayMs)
  }

  function waitForCallback(pkce: TPkce, state: string, authMode: OpenAIAuthMode): Promise<TTokens> {
    if (pendingOAuth) {
      return Promise.reject(new Error("Authorization already in progress"))
    }
    lastErrorState = undefined
    emitDebug("callback_wait_start", {
      authMode,
      stateTail: state.slice(-6)
    })
    return new Promise((resolve, reject) => {
      let settled = false
      const resolveOnce = (tokens: TTokens) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        emitDebug("callback_wait_resolved", { authMode })
        resolve(tokens)
      }
      const rejectOnce = (error: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        emitDebug("callback_wait_rejected", { authMode, error: error.message })
        reject(error)
      }
      const timeout = setTimeout(() => {
        pendingOAuth = undefined
        emitDebug("callback_wait_timeout", { authMode, timeoutMs: input.callbackTimeoutMs })
        rejectOnce(new Error("OAuth callback timeout - authorization took too long"))
      }, input.callbackTimeoutMs)

      pendingOAuth = {
        pkce,
        state,
        authMode,
        resolve: resolveOnce,
        reject: rejectOnce
      }
    })
  }

  return {
    isDebugEnabled,
    emitDebug,
    start,
    stop,
    scheduleStop,
    waitForCallback
  }
}
