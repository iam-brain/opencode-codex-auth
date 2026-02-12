import http from "node:http"
import os from "node:os"
import path from "node:path"
import { appendFileSync, chmodSync, mkdirSync } from "node:fs"

import type { OpenAIAuthMode } from "../types"

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
  const debugLogDir = input.debugLogDir ?? path.join(os.homedir(), ".config", "opencode", "logs", "codex-plugin")
  const debugLogFile = input.debugLogFile ?? path.join(debugLogDir, "oauth-lifecycle.log")

  let oauthServer: http.Server | undefined
  let pendingOAuth: PendingOAuth<TPkce, TTokens> | undefined
  let oauthServerCloseTimer: ReturnType<typeof setTimeout> | undefined

  function isDebugEnabled(): boolean {
    const raw = process.env.CODEX_AUTH_DEBUG?.trim().toLowerCase()
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
  }

  function emitDebug(event: string, meta: Record<string, unknown> = {}): void {
    if (!isDebugEnabled()) return
    const payload: Record<string, unknown> = {
      ts: new Date().toISOString(),
      pid: process.pid,
      event,
      ...meta
    }
    const line = JSON.stringify(payload)
    try {
      console.error(`[codex-auth-debug] ${line}`)
    } catch {
      // best effort stderr logging
    }
    try {
      mkdirSync(debugLogDir, { recursive: true, mode: 0o700 })
      appendFileSync(debugLogFile, `${line}\n`, { encoding: "utf8", mode: 0o600 })
      chmodSync(debugLogFile, 0o600)
    } catch {
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
    return normalized === "127.0.0.1" || normalized === "::1" || normalized === "::ffff:127.0.0.1"
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

          if (error) {
            const errorMsg = errorDescription || error
            emitDebug("callback_error", { reason: errorMsg })
            pendingOAuth?.reject(new Error(errorMsg))
            pendingOAuth = undefined
            sendHtml(200, input.buildOAuthErrorHtml(errorMsg))
            return
          }

          if (!code) {
            const errorMsg = "Missing authorization code"
            emitDebug("callback_error", { reason: errorMsg })
            pendingOAuth?.reject(new Error(errorMsg))
            pendingOAuth = undefined
            sendHtml(400, input.buildOAuthErrorHtml(errorMsg))
            return
          }

          if (!pendingOAuth || state !== pendingOAuth.state) {
            const errorMsg = "Invalid state - potential CSRF attack"
            emitDebug("callback_error", { reason: errorMsg })
            pendingOAuth?.reject(new Error(errorMsg))
            pendingOAuth = undefined
            sendHtml(400, input.buildOAuthErrorHtml(errorMsg))
            return
          }

          const current = pendingOAuth
          pendingOAuth = undefined
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
              sendHtml(500, input.buildOAuthErrorHtml(oauthError.message))
            })
          return
        }

        if (url.pathname === "/success") {
          emitDebug("callback_success_page")
          sendHtml(200, input.buildOAuthSuccessHtml("codex"))
          return
        }

        if (url.pathname === "/cancel") {
          emitDebug("callback_cancel")
          pendingOAuth?.reject(new Error("Login cancelled"))
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
        res.end(`Server error: ${(error as Error).message}`)
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
      } catch {
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
