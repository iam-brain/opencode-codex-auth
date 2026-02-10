import type { Hooks, PluginInput } from "@opencode-ai/plugin"

import http from "node:http"
import os from "node:os"
import { execFile, execFileSync } from "node:child_process"
import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

import {
  extractAccountIdFromClaims as extractAccountIdFromClaimsBase,
  extractEmailFromClaims,
  extractPlanFromClaims,
  parseJwtClaims,
  type IdTokenClaims
} from "./claims"
import { CodexStatus, type HeaderMap } from "./codex-status"
import { saveSnapshots } from "./codex-status-storage"
import {
  PluginFatalError,
  formatWaitTime,
  isPluginFatalError,
  toSyntheticErrorResponse
} from "./fatal-errors"
import { buildIdentityKey, ensureIdentityKey, normalizeEmail, normalizePlan } from "./identity"
import { defaultSnapshotsPath } from "./paths"
import { createStickySessionState, selectAccount } from "./rotation"
import {
  ensureOpenAIOAuthDomain,
  getOpenAIOAuthDomain,
  importLegacyInstallData,
  listOpenAIOAuthDomains,
  loadAuthStorage,
  saveAuthStorage,
  setAccountCooldown,
  shouldOfferLegacyTransfer
} from "./storage"
import { toolOutputForStatus } from "./codex-status-tool"
import type { Logger } from "./logger"
import type {
  AccountAuthType,
  AccountRecord,
  AuthFile,
  OpenAIAuthMode,
  OpenAIOAuthDomain
} from "./types"
import { FetchOrchestrator, createFetchOrchestratorState } from "./fetch-orchestrator"
import type {
  CodexSpoofMode,
  CustomSettings,
  PersonalityOption,
  PluginRuntimeMode
} from "./config"
import { formatToastMessage } from "./toast"
import { runAuthMenuOnce } from "./ui/auth-menu-runner"
import type { AccountInfo, DeleteScope } from "./ui/auth-menu"
import {
  applyCodexCatalogToProviderModels,
  getCodexModelCatalog,
  resolveInstructionsForModel,
  type CodexModelInfo
} from "./model-catalog"
import { CODEX_RS_COMPACT_PROMPT } from "./orchestrator-agents"
import { sanitizeRequestPayloadForCompat } from "./compat-sanitizer"
import { fetchQuotaSnapshotFromBackend } from "./codex-quota-fetch"
import { createRequestSnapshots } from "./request-snapshots"
import { CODEX_OAUTH_SUCCESS_HTML } from "./oauth-pages"

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const OAUTH_PORT = 1455
const OAUTH_DUMMY_KEY = "oauth_dummy_key"
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000
const AUTH_REFRESH_FAILURE_COOLDOWN_MS = 30_000
const OAUTH_CALLBACK_TIMEOUT_MS = (() => {
  const raw = process.env.CODEX_OAUTH_CALLBACK_TIMEOUT_MS
  if (!raw) return 10 * 60 * 1000
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 60_000 ? parsed : 10 * 60 * 1000
})()
const OAUTH_SERVER_SHUTDOWN_GRACE_MS = (() => {
  const raw = process.env.CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS
  if (!raw) return 2000
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2000
})()
const OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS = (() => {
  const raw = process.env.CODEX_OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS
  if (!raw) return 60_000
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 60_000
})()
const OAUTH_DEBUG_LOG_DIR = path.join(os.homedir(), ".config", "opencode", "logs", "codex-plugin")
const OAUTH_DEBUG_LOG_FILE = path.join(OAUTH_DEBUG_LOG_DIR, "oauth-lifecycle.log")
const execFileAsync = promisify(execFile)
const DEFAULT_PLUGIN_VERSION = "0.1.0"
const INTERNAL_COLLABORATION_MODE_HEADER = "x-opencode-collaboration-mode-kind"
const CODEX_PLAN_MODE_INSTRUCTIONS = [
  "# Plan Mode",
  "",
  "You are in Plan Mode. Focus on producing a decision-complete implementation plan before making code changes.",
  "Use non-mutating exploration first, ask focused questions only when needed, and make assumptions explicit.",
  "If asked to execute while still in plan mode, continue planning until the active agent switches out of plan mode."
].join("\n")
const CODEX_CODE_MODE_INSTRUCTIONS = "you are now in code mode."
const CODEX_EXECUTE_MODE_INSTRUCTIONS = [
  "# Collaboration Style: Execute",
  "You execute on a well-specified task independently and report progress.",
  "",
  "You do not collaborate on decisions in this mode. You execute end-to-end.",
  "You make reasonable assumptions when the user hasn't specified something, and you proceed without asking questions."
].join("\n")
const CODEX_PAIR_PROGRAMMING_MODE_INSTRUCTIONS = [
  "# Collaboration Style: Pair Programming",
  "",
  "## Build together as you go",
  "You treat collaboration as pairing by default. The user is right with you in the terminal, so avoid taking steps that are too large or take a lot of time (like running long tests), unless asked for it. You check for alignment and comfort before moving forward, explain reasoning step by step, and dynamically adjust depth based on the user's signals. There is no need to ask multiple rounds of questions—build as you go. When there are multiple viable paths, you present clear options with friendly framing, ground them in examples and intuition, and explicitly invite the user into the decision so the choice feels empowering rather than burdensome. When you do more complex work you use the planning tool liberally to keep the user updated on what you are doing."
].join("\n")

const STATIC_FALLBACK_MODELS = [
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.3-codex",
  "gpt-5.1-codex"
]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type BrowserOpenInvocation = {
  command: string
  args: string[]
}

export function browserOpenInvocationFor(
  url: string,
  platform: NodeJS.Platform = process.platform
): BrowserOpenInvocation {
  if (platform === "darwin") {
    return { command: "open", args: [url] }
  }
  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] }
  }
  return { command: "xdg-open", args: [url] }
}

export async function tryOpenUrlInBrowser(
  url: string,
  log?: Logger
): Promise<boolean> {
  if (process.env.OPENCODE_NO_BROWSER === "1") return false
  if (process.env.VITEST || process.env.NODE_ENV === "test") return false
  const invocation = browserOpenInvocationFor(url)
  emitOAuthDebug("browser_open_attempt", { command: invocation.command })
  try {
    await execFileAsync(invocation.command, invocation.args, { windowsHide: true, timeout: 5000 })
    emitOAuthDebug("browser_open_success", { command: invocation.command })
    return true
  } catch (error) {
    emitOAuthDebug("browser_open_failure", {
      command: invocation.command,
      error: error instanceof Error ? error.message : String(error)
    })
    log?.warn("failed to auto-open oauth URL", {
      command: invocation.command,
      error: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

type PkceCodes = {
  verifier: string
  challenge: string
}

async function generatePKCE(): Promise<PkceCodes> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(64)))
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  const challenge = base64UrlEncode(new Uint8Array(hash))
  return { verifier, challenge }
}

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
}

export function extractAccountIdFromClaims(claims: IdTokenClaims | undefined):
  | string
  | undefined {
  return extractAccountIdFromClaimsBase(claims)
}

type TokensWithClaims = {
  id_token?: string
  access_token?: string
}

export function extractAccountId(tokens: TokensWithClaims | undefined): string | undefined {
  if (!tokens) return undefined

  if (tokens.id_token) {
    const accountId = extractAccountIdFromClaims(parseJwtClaims(tokens.id_token))
    if (accountId) return accountId
  }

  if (tokens.access_token) {
    return extractAccountIdFromClaims(parseJwtClaims(tokens.access_token))
  }

  return undefined
}

export type TokenResponse = {
  id_token?: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

type OAuthTokenRefreshError = Error & {
  status?: number
  oauthCode?: string
}

function isOAuthTokenRefreshError(value: unknown): value is OAuthTokenRefreshError {
  return value instanceof Error && ("status" in value || "oauthCode" in value)
}

function buildAuthorizeUrl(
  redirectUri: string,
  pkce: PkceCodes,
  state: string,
  originator: "opencode" | "codex_cli_rs"
): string {
  const query = [
    ["response_type", "code"],
    ["client_id", CLIENT_ID],
    ["redirect_uri", redirectUri],
    ["scope", "openid profile email offline_access"],
    ["code_challenge", pkce.challenge],
    ["code_challenge_method", "S256"],
    ["id_token_add_organizations", "true"],
    ["codex_cli_simplified_flow", "true"],
    ["state", state],
    ["originator", originator]
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&")

  return `${ISSUER}/oauth/authorize?${query}`
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
  resolveHookAgentName,
  resolveCollaborationModeKind,
  resolveSubagentHeaderValue,
  stopOAuthServer
}

async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  pkce: PkceCodes
): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier
    }).toString()
  })

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`)
  }
  return (await response.json()) as TokenResponse
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID
    }).toString()
  })

  if (!response.ok) {
    let oauthCode: string | undefined
    let oauthDescription: string | undefined
    try {
      const raw = await response.text()
      if (raw) {
        const payload = JSON.parse(raw) as Record<string, unknown>
        if (typeof payload.error === "string") oauthCode = payload.error
        if (typeof payload.error_description === "string") {
          oauthDescription = payload.error_description
        }
      }
    } catch {
      // Best effort parse only.
    }

    const detail = oauthCode
      ? `${oauthCode}${oauthDescription ? `: ${oauthDescription}` : ""}`
      : `status ${response.status}`
    const error = new Error(`Token refresh failed (${detail})`) as OAuthTokenRefreshError
    error.status = response.status
    error.oauthCode = oauthCode
    throw error
  }
  return (await response.json()) as TokenResponse
}

function getOpenAIAuthClaims(token: string | undefined): Record<string, unknown> {
  if (!token) return {}
  const claims = parseJwtClaims(token)
  const authClaims = claims?.["https://api.openai.com/auth"]
  if (!authClaims || typeof authClaims !== "object" || Array.isArray(authClaims)) {
    return {}
  }
  return authClaims as Record<string, unknown>
}

function getClaimString(claims: Record<string, unknown>, key: string): string {
  const value = claims[key]
  return typeof value === "string" ? value : ""
}

function getClaimBoolean(claims: Record<string, unknown>, key: string): boolean {
  const value = claims[key]
  return typeof value === "boolean" ? value : false
}

function composeCodexSuccessRedirectUrl(
  tokens: TokenResponse,
  options: { issuer?: string; port?: number } = {}
): string {
  const issuer = options.issuer ?? ISSUER
  const port = options.port ?? OAUTH_PORT
  const idClaims = getOpenAIAuthClaims(tokens.id_token)
  const accessClaims = getOpenAIAuthClaims(tokens.access_token)

  const needsSetup =
    !getClaimBoolean(idClaims, "completed_platform_onboarding") &&
    getClaimBoolean(idClaims, "is_org_owner")

  const platformUrl =
    issuer === ISSUER ? "https://platform.openai.com" : "https://platform.api.openai.org"

  const params = new URLSearchParams({
    id_token: tokens.id_token ?? "",
    needs_setup: String(needsSetup),
    org_id: getClaimString(idClaims, "organization_id"),
    project_id: getClaimString(idClaims, "project_id"),
    plan_type: getClaimString(accessClaims, "chatgpt_plan_type"),
    platform_url: platformUrl
  })

  return `http://localhost:${port}/success?${params.toString()}`
}

function buildOAuthSuccessHtml(mode: CodexSpoofMode = "codex"): string {
  if (mode === "codex") return CODEX_OAUTH_SUCCESS_HTML

  return `<!doctype html>
<html>
  <head>
    <title>OpenCode - Codex Authorization Successful</title>
    <style>
      body {
        font-family: system-ui, -apple-system, sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #f1ecec;
        margin-bottom: 1rem;
      }
      p {
        color: #b7b1b1;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Successful</h1>
      <p>You can close this window and return to OpenCode.</p>
    </div>
    <script>
      setTimeout(() => window.close(), 2000)
    </script>
  </body>
</html>`
}

function buildOAuthErrorHtml(error: string): string {
  return `<!doctype html>
<html>
  <head>
    <title>Sign into Codex</title>
    <style>
      body {
        font-family: system-ui, -apple-system, sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        margin: 0;
        background: #131010;
        color: #f1ecec;
      }
      .container {
        text-align: center;
        padding: 2rem;
      }
      h1 {
        color: #fc533a;
        margin-bottom: 1rem;
      }
      .error {
        color: #ff917b;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        margin-top: 1rem;
        padding: 1rem;
        background: #3c140d;
        border-radius: 0.5rem;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Sign-in failed</h1>
      <p>An error occurred during authorization.</p>
      <div class="error">${escapeHtml(error)}</div>
    </div>
  </body>
</html>`
}

type PendingOAuth = {
  pkce: PkceCodes
  state: string
  authMode: OpenAIAuthMode
  resolve: (tokens: TokenResponse) => void
  reject: (error: Error) => void
}

let oauthServer: http.Server | undefined
let pendingOAuth: PendingOAuth | undefined
let oauthServerCloseTimer: ReturnType<typeof setTimeout> | undefined

function isOAuthDebugEnabled(): boolean {
  return process.env.CODEX_AUTH_DEBUG === "1"
}

function emitOAuthDebug(event: string, meta: Record<string, unknown> = {}): void {
  if (!isOAuthDebugEnabled()) return
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
    mkdirSync(OAUTH_DEBUG_LOG_DIR, { recursive: true, mode: 0o700 })
    appendFileSync(OAUTH_DEBUG_LOG_FILE, `${line}\n`, { encoding: "utf8", mode: 0o600 })
  } catch {
    // best effort file logging
  }
}

function clearOAuthServerCloseTimer(): void {
  if (!oauthServerCloseTimer) return
  clearTimeout(oauthServerCloseTimer)
  oauthServerCloseTimer = undefined
}

async function startOAuthServer(): Promise<{ redirectUri: string }> {
  clearOAuthServerCloseTimer()
  if (oauthServer) {
    emitOAuthDebug("server_reuse", { port: OAUTH_PORT })
    return { redirectUri: `http://localhost:${OAUTH_PORT}/auth/callback` }
  }

  emitOAuthDebug("server_starting", { port: OAUTH_PORT })
  oauthServer = http.createServer((req, res) => {
    try {
      const base = `http://${req.headers.host ?? `localhost:${OAUTH_PORT}`}`
      const url = new URL(req.url ?? "/", base)

      const sendHtml = (status: number, html: string) => {
        res.statusCode = status
        res.setHeader("Content-Type", "text/html")
        res.end(html)
      }
      const redirect = (location: string) => {
        res.statusCode = 302
        res.setHeader("Location", location)
        res.end()
      }

      if (url.pathname === "/auth/callback") {
        const code = url.searchParams.get("code")
        const state = url.searchParams.get("state")
        const error = url.searchParams.get("error")
        const errorDescription = url.searchParams.get("error_description")
        emitOAuthDebug("callback_hit", {
          hasCode: Boolean(code),
          hasState: Boolean(state),
          hasError: Boolean(error)
        })

        if (error) {
          const errorMsg = errorDescription || error
          emitOAuthDebug("callback_error", { reason: errorMsg })
          pendingOAuth?.reject(new Error(errorMsg))
          pendingOAuth = undefined
          sendHtml(200, buildOAuthErrorHtml(errorMsg))
          return
        }

        if (!code) {
          const errorMsg = "Missing authorization code"
          emitOAuthDebug("callback_error", { reason: errorMsg })
          pendingOAuth?.reject(new Error(errorMsg))
          pendingOAuth = undefined
          sendHtml(400, buildOAuthErrorHtml(errorMsg))
          return
        }

        if (!pendingOAuth || state !== pendingOAuth.state) {
          const errorMsg = "Invalid state - potential CSRF attack"
          emitOAuthDebug("callback_error", { reason: errorMsg })
          pendingOAuth?.reject(new Error(errorMsg))
          pendingOAuth = undefined
          sendHtml(400, buildOAuthErrorHtml(errorMsg))
          return
        }

        const current = pendingOAuth
        pendingOAuth = undefined
        emitOAuthDebug("token_exchange_start", { authMode: current.authMode })
        exchangeCodeForTokens(code, `http://localhost:${OAUTH_PORT}/auth/callback`, current.pkce)
          .then((tokens) => {
            current.resolve(tokens)
            emitOAuthDebug("token_exchange_success", { authMode: current.authMode })
            if (res.writableEnded) return
            if (current.authMode === "codex") {
              redirect(composeCodexSuccessRedirectUrl(tokens))
              return
            }
            sendHtml(200, buildOAuthSuccessHtml("native"))
          })
          .catch((err) => {
            const oauthError = err instanceof Error ? err : new Error(String(err))
            current.reject(oauthError)
            emitOAuthDebug("token_exchange_error", { error: oauthError.message })
            if (res.writableEnded) return
            sendHtml(500, buildOAuthErrorHtml(oauthError.message))
          })
        return
      }

      if (url.pathname === "/success") {
        emitOAuthDebug("callback_success_page")
        sendHtml(200, buildOAuthSuccessHtml("codex"))
        return
      }

      if (url.pathname === "/cancel") {
        emitOAuthDebug("callback_cancel")
        pendingOAuth?.reject(new Error("Login cancelled"))
        pendingOAuth = undefined
        res.statusCode = 200
        res.end("Login cancelled")
        return
      }

      res.statusCode = 404
      res.end("Not found")
    } catch (error) {
      res.statusCode = 500
      res.end(`Server error: ${(error as Error).message}`)
    }
  })

  try {
    await new Promise<void>((resolve, reject) => {
      oauthServer?.once("error", reject)
      oauthServer?.listen(OAUTH_PORT, () => resolve())
    })
    emitOAuthDebug("server_started", { port: OAUTH_PORT })
  } catch (error) {
    emitOAuthDebug("server_start_error", {
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

  return { redirectUri: `http://localhost:${OAUTH_PORT}/auth/callback` }
}

function stopOAuthServer(): void {
  clearOAuthServerCloseTimer()
  emitOAuthDebug("server_stopping", { hadPendingOAuth: Boolean(pendingOAuth) })
  oauthServer?.close()
  oauthServer = undefined
  emitOAuthDebug("server_stopped")
}

function scheduleOAuthServerStop(
  delayMs = OAUTH_SERVER_SHUTDOWN_GRACE_MS,
  reason: "success" | "error" | "other" = "other"
): void {
  if (!oauthServer) return
  clearOAuthServerCloseTimer()
  emitOAuthDebug("server_stop_scheduled", { delayMs, reason })
  oauthServerCloseTimer = setTimeout(() => {
    oauthServerCloseTimer = undefined
    if (pendingOAuth) return
    emitOAuthDebug("server_stop_timer_fired", { reason })
    stopOAuthServer()
  }, delayMs)
}

function waitForOAuthCallback(
  pkce: PkceCodes,
  state: string,
  authMode: OpenAIAuthMode
): Promise<TokenResponse> {
  emitOAuthDebug("callback_wait_start", {
    authMode,
    stateTail: state.slice(-6)
  })
  return new Promise((resolve, reject) => {
    let settled = false
    const resolveOnce = (tokens: TokenResponse) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      emitOAuthDebug("callback_wait_resolved", { authMode })
      resolve(tokens)
    }
    const rejectOnce = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      emitOAuthDebug("callback_wait_rejected", { authMode, error: error.message })
      reject(error)
    }
    const timeout = setTimeout(() => {
      pendingOAuth = undefined
      emitOAuthDebug("callback_wait_timeout", { authMode, timeoutMs: OAUTH_CALLBACK_TIMEOUT_MS })
      rejectOnce(new Error("OAuth callback timeout - authorization took too long"))
    }, OAUTH_CALLBACK_TIMEOUT_MS)

    pendingOAuth = {
      pkce,
      state,
      authMode,
      resolve: resolveOnce,
      reject: rejectOnce
    }
  })
}

function modeForRuntimeMode(runtimeMode: PluginRuntimeMode): OpenAIAuthMode {
  return runtimeMode === "native" ? "native" : "codex"
}

const ACCOUNT_AUTH_TYPE_ORDER: AccountAuthType[] = ["native", "codex"]

function normalizeAccountAuthTypes(input: unknown): AccountAuthType[] {
  const source = Array.isArray(input) ? input : ["native"]
  const seen = new Set<AccountAuthType>()
  const out: AccountAuthType[] = []

  for (const rawType of source) {
    const type = rawType === "codex" ? "codex" : rawType === "native" ? "native" : undefined
    if (!type || seen.has(type)) continue
    seen.add(type)
    out.push(type)
  }

  if (out.length === 0) out.push("native")
  out.sort((a, b) => ACCOUNT_AUTH_TYPE_ORDER.indexOf(a) - ACCOUNT_AUTH_TYPE_ORDER.indexOf(b))
  return out
}

function mergeAccountAuthTypes(existing: unknown, incoming: unknown): AccountAuthType[] {
  const merged = [...normalizeAccountAuthTypes(existing), ...normalizeAccountAuthTypes(incoming)]
  return normalizeAccountAuthTypes(merged)
}

function removeAccountAuthType(
  existing: unknown,
  scope: Exclude<DeleteScope, "both">
): AccountAuthType[] {
  return normalizeAccountAuthTypes(existing).filter((type) => type !== scope)
}

export function upsertAccount(
  openai: OpenAIOAuthDomain,
  incoming: AccountRecord
): AccountRecord {
  const normalizedEmail = normalizeEmail(incoming.email)
  const normalizedPlan = normalizePlan(incoming.plan)
  const normalizedAccountId = incoming.accountId?.trim()
  const strictIdentityKey = buildIdentityKey({
    accountId: normalizedAccountId,
    email: normalizedEmail,
    plan: normalizedPlan
  })
  const strictMatch = strictIdentityKey
    ? openai.accounts.find((existing) => {
        const existingAccountId = existing.accountId?.trim()
        const existingEmail = normalizeEmail(existing.email)
        const existingPlan = normalizePlan(existing.plan)
        return (
          existingAccountId === normalizedAccountId &&
          existingEmail === normalizedEmail &&
          existingPlan === normalizedPlan
        )
      })
    : undefined

  const refreshFallbackMatch =
    strictMatch || !incoming.refresh
      ? undefined
      : openai.accounts.find((existing) => existing.refresh === incoming.refresh)

  const match = strictMatch ?? refreshFallbackMatch
  const matchedByRefreshFallback = refreshFallbackMatch !== undefined && strictMatch === undefined
  const requiresInsert =
    matchedByRefreshFallback &&
    strictIdentityKey !== undefined &&
    match?.identityKey !== undefined &&
    match.identityKey !== strictIdentityKey

  const target = !match || requiresInsert ? ({} as AccountRecord) : match
  if (!match || requiresInsert) {
    openai.accounts.push(target)
  }

  if (!matchedByRefreshFallback || requiresInsert) {
    if (normalizedAccountId) target.accountId = normalizedAccountId
    if (normalizedEmail) target.email = normalizedEmail
    if (normalizedPlan) target.plan = normalizedPlan
  }

  if (incoming.enabled !== undefined) target.enabled = incoming.enabled
  if (incoming.refresh) target.refresh = incoming.refresh
  if (incoming.access) target.access = incoming.access
  if (incoming.expires !== undefined) target.expires = incoming.expires
  if (incoming.lastUsed !== undefined) target.lastUsed = incoming.lastUsed
  target.authTypes = normalizeAccountAuthTypes(incoming.authTypes ?? match?.authTypes)

  ensureIdentityKey(target)
  if (!target.identityKey && strictIdentityKey) target.identityKey = strictIdentityKey

  return target
}

function rewriteUrl(requestInput: string | URL | Request): URL {
  const parsed =
    requestInput instanceof URL
      ? requestInput
      : new URL(typeof requestInput === "string" ? requestInput : requestInput.url)

  if (
    parsed.pathname.includes("/v1/responses") ||
    parsed.pathname.includes("/chat/completions")
  ) {
    return new URL(CODEX_API_ENDPOINT)
  }

  return parsed
}

function opencodeUserAgent(): string {
  return `opencode-codex-auth ( ${os.platform()} ${os.release()}; ${os.arch()} )`
}

type CodexOriginator = "codex_cli_rs" | "codex_exec"

let cachedPluginVersion: string | undefined
let cachedMacProductVersion: string | undefined
let cachedTerminalUserAgentToken: string | undefined

function isPrintableAscii(value: string): boolean {
  if (!value) return false
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code > 0x7e) return false
  }
  return true
}

function sanitizeUserAgentCandidate(candidate: string, fallback: string, originator: string): string {
  if (isPrintableAscii(candidate)) return candidate

  const sanitized = Array.from(candidate)
    .map((char) => {
      const code = char.charCodeAt(0)
      return code >= 0x20 && code <= 0x7e ? char : "_"
    })
    .join("")

  if (isPrintableAscii(sanitized)) return sanitized
  if (isPrintableAscii(fallback)) return fallback
  return originator
}

function sanitizeTerminalToken(value: string): string {
  return value.replace(/[^A-Za-z0-9._/-]/g, "_")
}

function nonEmptyEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim()
  return value ? value : undefined
}

function splitProgramAndVersion(value: string): { program: string; version?: string } {
  const [program, version] = value.trim().split(/\s+/, 2)
  return {
    program: program ?? "unknown",
    ...(version ? { version } : {})
  }
}

function tmuxDisplayMessage(format: string): string | undefined {
  try {
    const value = execFileSync("tmux", ["display-message", "-p", format], { encoding: "utf8" }).trim()
    return value || undefined
  } catch {
    return undefined
  }
}

function resolveTerminalUserAgentToken(env: NodeJS.ProcessEnv = process.env): string {
  if (cachedTerminalUserAgentToken) return cachedTerminalUserAgentToken

  const termProgram = nonEmptyEnv(env, "TERM_PROGRAM")
  const termProgramVersion = nonEmptyEnv(env, "TERM_PROGRAM_VERSION")
  const term = nonEmptyEnv(env, "TERM")
  const hasTmux = Boolean(nonEmptyEnv(env, "TMUX") || nonEmptyEnv(env, "TMUX_PANE"))

  if (termProgram && termProgram.toLowerCase() === "tmux" && hasTmux) {
    const tmuxTermType = tmuxDisplayMessage("#{client_termtype}")
    if (tmuxTermType) {
      const { program, version } = splitProgramAndVersion(tmuxTermType)
      cachedTerminalUserAgentToken = sanitizeTerminalToken(
        version ? `${program}/${version}` : program
      )
      return cachedTerminalUserAgentToken
    }
    const tmuxTermName = tmuxDisplayMessage("#{client_termname}")
    if (tmuxTermName) {
      cachedTerminalUserAgentToken = sanitizeTerminalToken(tmuxTermName)
      return cachedTerminalUserAgentToken
    }
  }

  if (termProgram) {
    cachedTerminalUserAgentToken = sanitizeTerminalToken(
      termProgramVersion ? `${termProgram}/${termProgramVersion}` : termProgram
    )
    return cachedTerminalUserAgentToken
  }

  const weztermVersion = nonEmptyEnv(env, "WEZTERM_VERSION")
  if (weztermVersion) {
    cachedTerminalUserAgentToken = sanitizeTerminalToken(`WezTerm/${weztermVersion}`)
    return cachedTerminalUserAgentToken
  }

  if (env.ITERM_SESSION_ID || env.ITERM_PROFILE || env.ITERM_PROFILE_NAME) {
    cachedTerminalUserAgentToken = "iTerm.app"
    return cachedTerminalUserAgentToken
  }

  if (env.TERM_SESSION_ID) {
    cachedTerminalUserAgentToken = "Apple_Terminal"
    return cachedTerminalUserAgentToken
  }

  if (env.KITTY_WINDOW_ID || term?.includes("kitty")) {
    cachedTerminalUserAgentToken = "kitty"
    return cachedTerminalUserAgentToken
  }

  if (env.ALACRITTY_SOCKET || term === "alacritty") {
    cachedTerminalUserAgentToken = "Alacritty"
    return cachedTerminalUserAgentToken
  }

  const konsoleVersion = nonEmptyEnv(env, "KONSOLE_VERSION")
  if (konsoleVersion) {
    cachedTerminalUserAgentToken = sanitizeTerminalToken(`Konsole/${konsoleVersion}`)
    return cachedTerminalUserAgentToken
  }

  if (env.GNOME_TERMINAL_SCREEN) {
    cachedTerminalUserAgentToken = "gnome-terminal"
    return cachedTerminalUserAgentToken
  }

  const vteVersion = nonEmptyEnv(env, "VTE_VERSION")
  if (vteVersion) {
    cachedTerminalUserAgentToken = sanitizeTerminalToken(`VTE/${vteVersion}`)
    return cachedTerminalUserAgentToken
  }

  if (env.WT_SESSION) {
    cachedTerminalUserAgentToken = "WindowsTerminal"
    return cachedTerminalUserAgentToken
  }

  if (term) {
    cachedTerminalUserAgentToken = sanitizeTerminalToken(term)
    return cachedTerminalUserAgentToken
  }

  cachedTerminalUserAgentToken = "unknown"
  return cachedTerminalUserAgentToken
}

function resolvePluginVersion(): string {
  if (cachedPluginVersion) return cachedPluginVersion

  const fromEnv = process.env.npm_package_version?.trim()
  if (fromEnv) {
    cachedPluginVersion = fromEnv
    return cachedPluginVersion
  }

  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8")
    const parsed = JSON.parse(raw) as { version?: unknown }
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      cachedPluginVersion = parsed.version.trim()
      return cachedPluginVersion
    }
  } catch {
    // Use fallback version below.
  }

  cachedPluginVersion = DEFAULT_PLUGIN_VERSION
  return cachedPluginVersion
}

function resolveMacProductVersion(): string {
  if (cachedMacProductVersion) return cachedMacProductVersion
  try {
    const value = execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim()
    cachedMacProductVersion = value || os.release()
  } catch {
    cachedMacProductVersion = os.release()
  }
  return cachedMacProductVersion
}

function normalizeArchitecture(architecture: string): string {
  if (architecture === "x64") return "x86_64"
  if (architecture === "arm64") return "arm64"
  return architecture || "unknown"
}

function resolveCodexPlatformSignature(platform: NodeJS.Platform = process.platform): string {
  const architecture = normalizeArchitecture(os.arch())
  if (platform === "darwin") {
    return `Mac OS ${resolveMacProductVersion()}; ${architecture}`
  }
  if (platform === "win32") {
    return `Windows ${os.release()}; ${architecture}`
  }
  if (platform === "linux") {
    return `Linux ${os.release()}; ${architecture}`
  }
  return `${platform} ${os.release()}; ${architecture}`
}

function buildCodexUserAgent(originator: CodexOriginator): string {
  const buildVersion = resolvePluginVersion()
  const terminalToken = resolveTerminalUserAgentToken()
  const prefix = `${originator}/${buildVersion} (${resolveCodexPlatformSignature()}) ${terminalToken}`
  return sanitizeUserAgentCandidate(prefix, prefix, originator)
}

function resolveRequestUserAgent(spoofMode: CodexSpoofMode, originator: CodexOriginator): string {
  if (spoofMode === "codex") return buildCodexUserAgent(originator)
  return opencodeUserAgent()
}

type CodexCollaborationModeKind = "plan" | "code" | "execute" | "pair_programming"
type CodexCollaborationProfile = {
  enabled: boolean
  kind?: CodexCollaborationModeKind
  normalizedAgentName?: string
}

function resolveHookAgentName(agent: unknown): string | undefined {
  const direct = asString(agent)
  if (direct) return direct
  if (!isRecord(agent)) return undefined
  return asString(agent.name) ?? asString(agent.agent)
}

function normalizeAgentNameForCollaboration(agentName: string): string {
  return agentName.trim().toLowerCase().replace(/\s+/g, "-")
}

function tokenizeAgentName(normalizedAgentName: string): string[] {
  return normalizedAgentName
    .split(/[-./:_]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

function isPluginCollaborationAgent(normalizedAgentName: string): boolean {
  const tokens = tokenizeAgentName(normalizedAgentName)
  if (tokens.length === 0) return false
  if (tokens[0] !== "codex") return false
  return tokens.some((token) =>
    [
      "orchestrator",
      "default",
      "code",
      "plan",
      "planner",
      "execute",
      "pair",
      "pairprogramming",
      "review",
      "compact",
      "compaction"
    ].includes(token)
  )
}

function resolveCollaborationModeKindFromName(normalizedAgentName: string): CodexCollaborationModeKind {
  const tokens = tokenizeAgentName(normalizedAgentName)
  if (tokens.includes("plan") || tokens.includes("planner")) return "plan"
  if (tokens.includes("execute")) return "execute"
  if (tokens.includes("pair") || tokens.includes("pairprogramming")) return "pair_programming"
  return "code"
}

function resolveCollaborationProfile(agent: unknown): CodexCollaborationProfile {
  const name = resolveHookAgentName(agent)
  if (!name) return { enabled: false }
  const normalizedAgentName = normalizeAgentNameForCollaboration(name)
  if (!isPluginCollaborationAgent(normalizedAgentName)) {
    return { enabled: false, normalizedAgentName }
  }
  return {
    enabled: true,
    normalizedAgentName,
    kind: resolveCollaborationModeKindFromName(normalizedAgentName)
  }
}

function resolveCollaborationModeKind(agent: unknown): CodexCollaborationModeKind {
  const profile = resolveCollaborationProfile(agent)
  return profile.kind ?? "code"
}

function resolveCollaborationInstructions(kind: CodexCollaborationModeKind): string {
  if (kind === "plan") return CODEX_PLAN_MODE_INSTRUCTIONS
  if (kind === "execute") return CODEX_EXECUTE_MODE_INSTRUCTIONS
  if (kind === "pair_programming") return CODEX_PAIR_PROGRAMMING_MODE_INSTRUCTIONS
  return CODEX_CODE_MODE_INSTRUCTIONS
}

function mergeInstructions(base: string | undefined, extra: string): string {
  const normalizedExtra = extra.trim()
  if (!normalizedExtra) return base?.trim() ?? ""
  const normalizedBase = base?.trim()
  if (!normalizedBase) return normalizedExtra
  if (normalizedBase.includes(normalizedExtra)) return normalizedBase
  return `${normalizedBase}\n\n${normalizedExtra}`
}

function resolveSubagentHeaderValue(agent: unknown): string | undefined {
  const profile = resolveCollaborationProfile(agent)
  const normalized = profile.normalizedAgentName
  if (!profile.enabled || !normalized) {
    return undefined
  }
  const tokens = tokenizeAgentName(normalized)
  const isCodexPrimary =
    tokens[0] === "codex" &&
    (tokens.includes("orchestrator") ||
      tokens.includes("default") ||
      tokens.includes("code") ||
      tokens.includes("plan") ||
      tokens.includes("planner") ||
      tokens.includes("execute") ||
      tokens.includes("pair") ||
      tokens.includes("pairprogramming"))
  if (isCodexPrimary) {
    return undefined
  }
  if (tokens.includes("plan") || tokens.includes("planner")) {
    return undefined
  }
  if (normalized === "compaction") {
    return "compact"
  }
  if (normalized.includes("review")) return "review"
  if (normalized.includes("compact") || normalized.includes("compaction")) return "compact"
  return "collab_spawn"
}

async function sessionUsesOpenAIProvider(
  client: PluginInput["client"] | undefined,
  sessionID: string
): Promise<boolean> {
  const sessionApi = client?.session as
    | { messages: (input: unknown) => Promise<unknown> }
    | undefined
  if (!sessionApi || typeof sessionApi.messages !== "function") return false

  try {
    const response = await sessionApi.messages({ sessionID, limit: 100 })
    const rows = isRecord(response) && Array.isArray(response.data) ? response.data : []
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index]
      if (!isRecord(row) || !isRecord(row.info)) continue
      const info = row.info
      if (asString(info.role) !== "user") continue
      const model = isRecord(info.model) ? info.model : undefined
      const providerID = model
        ? asString(model.providerID)
        : asString(info.providerID)
      if (!providerID) continue
      return providerID === "openai"
    }
  } catch {
    return false
  }

  return false
}

function isTuiWorkerInvocation(argv: string[]): boolean {
  return argv.some((entry) => /(?:^|[\\/])tui[\\/]worker\.(?:js|ts)$/i.test(entry))
}

function resolveCodexOriginator(spoofMode: CodexSpoofMode, argv = process.argv): CodexOriginator {
  if (spoofMode !== "codex") return "codex_cli_rs"
  const normalizedArgv = argv.map((entry) => String(entry))
  if (isTuiWorkerInvocation(normalizedArgv)) return "codex_cli_rs"
  return normalizedArgv.includes("run") ? "codex_exec" : "codex_cli_rs"
}

function formatAccountLabel(
  account: { email?: string; plan?: string; accountId?: string } | undefined,
  index: number
): string {
  const email = account?.email?.trim()
  const plan = account?.plan?.trim()
  const accountId = account?.accountId?.trim()
  const idSuffix = accountId
    ? accountId.length > 6
      ? accountId.slice(-6)
      : accountId
    : null

  if (email && plan) return `${email} (${plan})`
  if (email) return email
  if (idSuffix) return `id:${idSuffix}`
  return `Account ${index + 1}`
}

function hasActiveCooldown(account: AccountRecord, now: number): boolean {
  return typeof account.cooldownUntil === "number" && Number.isFinite(account.cooldownUntil) && account.cooldownUntil > now
}

function ensureAccountAuthTypes(account: AccountRecord): AccountAuthType[] {
  const normalized = normalizeAccountAuthTypes(account.authTypes)
  account.authTypes = normalized
  return normalized
}

function reconcileActiveIdentityKey(openai: OpenAIOAuthDomain): void {
  if (
    openai.activeIdentityKey &&
    openai.accounts.some(
      (account) => account.identityKey === openai.activeIdentityKey && account.enabled !== false
    )
  ) {
    return
  }

  const fallback = openai.accounts.find((account) => account.enabled !== false && account.identityKey)
  openai.activeIdentityKey = fallback?.identityKey
}

function findDomainAccountIndex(domain: OpenAIOAuthDomain, account: AccountInfo): number {
  if (account.identityKey) {
    const byIdentity = domain.accounts.findIndex((entry) => entry.identityKey === account.identityKey)
    if (byIdentity >= 0) return byIdentity
  }
  return domain.accounts.findIndex((entry) => {
    const sameId = (entry.accountId?.trim() ?? "") === (account.accountId?.trim() ?? "")
    const sameEmail = normalizeEmail(entry.email) === normalizeEmail(account.email)
    const samePlan = normalizePlan(entry.plan) === normalizePlan(account.plan)
    return sameId && sameEmail && samePlan
  })
}

function buildAuthMenuAccounts(input: {
  native?: OpenAIOAuthDomain
  codex?: OpenAIOAuthDomain
  activeMode: OpenAIAuthMode
}): AccountInfo[] {
  const now = Date.now()
  const rows = new Map<string, AccountInfo>()

  const mergeFromDomain = (authMode: OpenAIAuthMode, domain?: OpenAIOAuthDomain) => {
    if (!domain) return
    for (const account of domain.accounts) {
      const normalizedTypes = ensureAccountAuthTypes(account)
      const identity =
        account.identityKey ??
        buildIdentityKey({
          accountId: account.accountId,
          email: normalizeEmail(account.email),
          plan: normalizePlan(account.plan)
        }) ??
        `${authMode}:${account.accountId ?? account.email ?? account.plan ?? "unknown"}`

      const existing = rows.get(identity)
      const currentStatus: AccountInfo["status"] = hasActiveCooldown(account, now)
        ? "rate-limited"
        : typeof account.expires === "number" &&
            Number.isFinite(account.expires) &&
            account.expires <= now
          ? "expired"
          : "unknown"

      if (!existing) {
        const isCurrentAccount = authMode === input.activeMode && Boolean(
          domain.activeIdentityKey && account.identityKey === domain.activeIdentityKey
        )
        rows.set(identity, {
          identityKey: account.identityKey,
          index: rows.size,
          accountId: account.accountId,
          email: account.email,
          plan: account.plan,
          authTypes: [authMode],
          lastUsed: account.lastUsed,
          enabled: account.enabled,
          status: isCurrentAccount ? "active" : currentStatus,
          isCurrentAccount
        })
        continue
      }

      existing.authTypes = normalizeAccountAuthTypes([...(existing.authTypes ?? []), authMode])
      if (
        typeof account.lastUsed === "number" &&
        (!existing.lastUsed || account.lastUsed > existing.lastUsed)
      ) {
        existing.lastUsed = account.lastUsed
      }
      if (existing.enabled === false && account.enabled !== false) {
        existing.enabled = true
      }
      if (existing.status !== "rate-limited" && currentStatus === "rate-limited") {
        existing.status = "rate-limited"
      } else if (
        existing.status !== "rate-limited" &&
        existing.status !== "expired" &&
        currentStatus === "expired"
      ) {
        existing.status = "expired"
      }
      const isCurrentAccount = authMode === input.activeMode && Boolean(
        domain.activeIdentityKey && account.identityKey === domain.activeIdentityKey
      )
      if (isCurrentAccount) {
        existing.isCurrentAccount = true
        existing.status = "active"
      }
    }
  }

  mergeFromDomain("native", input.native)
  mergeFromDomain("codex", input.codex)
  return Array.from(rows.values()).map((row, index) => ({ ...row, index }))
}

function hydrateAccountIdentityFromAccessClaims(account: AccountRecord): void {
  const claims =
    typeof account.access === "string" && account.access.length > 0
      ? parseJwtClaims(account.access)
      : undefined
  if (!account.accountId) account.accountId = extractAccountIdFromClaims(claims)
  if (!account.email) account.email = extractEmailFromClaims(claims)
  if (!account.plan) account.plan = extractPlanFromClaims(claims)
  account.email = normalizeEmail(account.email)
  account.plan = normalizePlan(account.plan)
  if (account.accountId) account.accountId = account.accountId.trim()
  ensureAccountAuthTypes(account)
  ensureIdentityKey(account)
}

export type CodexAuthPluginOptions = {
  log?: Logger
  personality?: PersonalityOption
  customSettings?: CustomSettings
  mode?: PluginRuntimeMode
  quietMode?: boolean
  pidOffsetEnabled?: boolean
  spoofMode?: CodexSpoofMode
  compatInputSanitizer?: boolean
  headerSnapshots?: boolean
}

async function selectCatalogAuthCandidate(
  authMode: OpenAIAuthMode,
  pidOffsetEnabled: boolean
): Promise<{ accessToken?: string; accountId?: string }> {
  try {
    const auth = await loadAuthStorage()
    const domain = getOpenAIOAuthDomain(auth, authMode)
    if (!domain) {
      return {}
    }

    const selected = selectAccount({
      accounts: domain.accounts,
      strategy: domain.strategy,
      activeIdentityKey: domain.activeIdentityKey,
      now: Date.now(),
      stickyPidOffset: pidOffsetEnabled
    })

    if (!selected?.access) {
      return { accountId: selected?.accountId }
    }

    if (selected.expires && selected.expires <= Date.now()) {
      return { accountId: selected.accountId }
    }

    return {
      accessToken: selected.access,
      accountId: selected.accountId
    }
  } catch {
    return {}
  }
}

type ChatParamsOutput = {
  temperature: number
  topP: number
  topK: number
  options: Record<string, unknown>
}

type ModelRuntimeDefaults = {
  applyPatchToolType?: string
  defaultReasoningEffort?: string
  supportsReasoningSummaries?: boolean
  reasoningSummaryFormat?: string
  defaultVerbosity?: "low" | "medium" | "high"
  supportsVerbosity?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function normalizeReasoningSummaryOption(value: unknown): "auto" | "concise" | "detailed" | undefined {
  const normalized = asString(value)?.toLowerCase()
  if (!normalized || normalized === "none") return undefined
  if (normalized === "auto" || normalized === "concise" || normalized === "detailed") return normalized
  return undefined
}

function readModelRuntimeDefaults(options: Record<string, unknown>): ModelRuntimeDefaults {
  const raw = options.codexRuntimeDefaults
  if (!isRecord(raw)) return {}
  return {
    applyPatchToolType: asString(raw.applyPatchToolType),
    defaultReasoningEffort: asString(raw.defaultReasoningEffort),
    supportsReasoningSummaries:
      typeof raw.supportsReasoningSummaries === "boolean" ? raw.supportsReasoningSummaries : undefined,
    reasoningSummaryFormat: asString(raw.reasoningSummaryFormat),
    defaultVerbosity:
      raw.defaultVerbosity === "low" || raw.defaultVerbosity === "medium" || raw.defaultVerbosity === "high"
        ? raw.defaultVerbosity
        : undefined,
    supportsVerbosity: typeof raw.supportsVerbosity === "boolean" ? raw.supportsVerbosity : undefined
  }
}

function mergeUnique(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function normalizePersonalityKey(value: unknown): string | undefined {
  const normalized = asString(value)?.toLowerCase()
  if (!normalized) return undefined
  if (normalized.includes("/") || normalized.includes("\\") || normalized.includes("..")) {
    return undefined
  }
  return normalized
}

function getModelLookupCandidates(model: {
  id?: string
  api?: { id?: string }
}): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (value: string | undefined) => {
    const trimmed = value?.trim()
    if (!trimmed) return
    if (seen.has(trimmed)) return
    seen.add(trimmed)
    out.push(trimmed)
  }

  add(model.id)
  add(model.api?.id)
  add(model.id?.split("/").pop())
  add(model.api?.id?.split("/").pop())

  return out
}

function getVariantLookupCandidates(input: {
  message?: unknown
  modelCandidates: string[]
}): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (value: string | undefined) => {
    const trimmed = value?.trim()
    if (!trimmed) return
    if (seen.has(trimmed)) return
    seen.add(trimmed)
    out.push(trimmed)
  }

  if (isRecord(input.message)) {
    add(asString(input.message.variant))
  }

  for (const candidate of input.modelCandidates) {
    const slash = candidate.lastIndexOf("/")
    if (slash <= 0 || slash >= candidate.length - 1) continue
    add(candidate.slice(slash + 1))
  }

  return out
}

function resolveCaseInsensitiveEntry<T>(
  entries: Record<string, T> | undefined,
  candidate: string
): T | undefined {
  if (!entries) return undefined

  const direct = entries[candidate]
  if (direct !== undefined) return direct

  const lowered = entries[candidate.toLowerCase()]
  if (lowered !== undefined) return lowered

  const loweredCandidate = candidate.toLowerCase()
  for (const [name, entry] of Object.entries(entries)) {
    if (name.trim().toLowerCase() === loweredCandidate) {
      return entry
    }
  }

  return undefined
}

function getModelPersonalityOverride(
  customSettings: CustomSettings | undefined,
  modelCandidates: string[],
  variantCandidates: string[]
): string | undefined {
  const models = customSettings?.models
  if (!models) return undefined

  for (const candidate of modelCandidates) {
    const entry = resolveCaseInsensitiveEntry(models, candidate)
    if (!entry) continue

    for (const variantCandidate of variantCandidates) {
      const variantEntry = resolveCaseInsensitiveEntry(entry.variants, variantCandidate)
      const variantPersonality = normalizePersonalityKey(variantEntry?.options?.personality)
      if (variantPersonality) return variantPersonality
    }

    const modelPersonality = normalizePersonalityKey(entry.options?.personality)
    if (modelPersonality) return modelPersonality
  }

  return undefined
}

function getModelThinkingSummariesOverride(
  customSettings: CustomSettings | undefined,
  modelCandidates: string[],
  variantCandidates: string[]
): boolean | undefined {
  const models = customSettings?.models
  if (!models) return undefined

  for (const candidate of modelCandidates) {
    const entry = resolveCaseInsensitiveEntry(models, candidate)
    if (!entry) continue

    for (const variantCandidate of variantCandidates) {
      const variantEntry = resolveCaseInsensitiveEntry(entry.variants, variantCandidate)
      if (typeof variantEntry?.thinkingSummaries === "boolean") {
        return variantEntry.thinkingSummaries
      }
    }

    if (typeof entry.thinkingSummaries === "boolean") {
      return entry.thinkingSummaries
    }
  }

  return undefined
}

function resolvePersonalityForModel(input: {
  customSettings?: CustomSettings
  modelCandidates: string[]
  variantCandidates: string[]
  fallback?: PersonalityOption
}): string | undefined {
  const modelOverride = getModelPersonalityOverride(
    input.customSettings,
    input.modelCandidates,
    input.variantCandidates
  )
  if (modelOverride) return modelOverride

  const globalOverride = normalizePersonalityKey(input.customSettings?.options?.personality)
  if (globalOverride) return globalOverride

  return normalizePersonalityKey(input.fallback)
}

function applyCodexRuntimeDefaultsToParams(input: {
  modelOptions: Record<string, unknown>
  modelToolCallCapable: boolean | undefined
  thinkingSummariesOverride: boolean | undefined
  output: ChatParamsOutput
}): void {
  const options = input.output.options
  const modelOptions = input.modelOptions
  const defaults = readModelRuntimeDefaults(modelOptions)
  const codexInstructions = asString(modelOptions.codexInstructions)

  if (codexInstructions && asString(options.instructions) === undefined) {
    options.instructions = codexInstructions
  }

  if (asString(options.reasoningEffort) === undefined && defaults.defaultReasoningEffort) {
    options.reasoningEffort = defaults.defaultReasoningEffort
  }

  const reasoningEffort = asString(options.reasoningEffort)
  const hasReasoning = reasoningEffort !== undefined && reasoningEffort !== "none"
  const rawReasoningSummary = asString(options.reasoningSummary)
  const hadExplicitReasoningSummary = rawReasoningSummary !== undefined
  const currentReasoningSummary = normalizeReasoningSummaryOption(rawReasoningSummary)
  if (rawReasoningSummary !== undefined) {
    if (currentReasoningSummary) {
      options.reasoningSummary = currentReasoningSummary
    } else {
      delete options.reasoningSummary
    }
  }
  if (!hadExplicitReasoningSummary && currentReasoningSummary === undefined) {
    if (
      hasReasoning &&
      (defaults.supportsReasoningSummaries === true || input.thinkingSummariesOverride === true)
    ) {
      if (input.thinkingSummariesOverride === false) {
        delete options.reasoningSummary
      } else {
        if (defaults.reasoningSummaryFormat?.toLowerCase() === "none") {
          delete options.reasoningSummary
        } else {
          options.reasoningSummary = defaults.reasoningSummaryFormat ?? "auto"
        }
      }
    }
  }

  if (
    asString(options.textVerbosity) === undefined &&
    defaults.defaultVerbosity &&
    (defaults.supportsVerbosity ?? true)
  ) {
    options.textVerbosity = defaults.defaultVerbosity
  }

  if (asString(options.applyPatchToolType) === undefined && defaults.applyPatchToolType) {
    options.applyPatchToolType = defaults.applyPatchToolType
  }

  if (typeof options.parallelToolCalls !== "boolean" && input.modelToolCallCapable !== undefined) {
    options.parallelToolCalls = input.modelToolCallCapable
  }

  const shouldIncludeReasoning =
    hasReasoning &&
    ((asString(options.reasoningSummary) !== undefined &&
      asString(options.reasoningSummary)?.toLowerCase() !== "none") ||
      defaults.supportsReasoningSummaries === true)

  if (shouldIncludeReasoning) {
    const include = asStringArray(options.include) ?? []
    options.include = mergeUnique([...include, "reasoning.encrypted_content"])
  }
}

function resolvePromptCacheKey(options: Record<string, unknown>): string | undefined {
  return asString(options.promptCacheKey)
}

async function sanitizeOutboundRequestIfNeeded(
  request: Request,
  enabled: boolean
): Promise<{ request: Request; changed: boolean }> {
  if (!enabled) return { request, changed: false }

  const method = request.method.toUpperCase()
  if (method !== "POST") return { request, changed: false }

  let payload: unknown
  try {
    const raw = await request.clone().text()
    if (!raw) return { request, changed: false }
    payload = JSON.parse(raw)
  } catch {
    return { request, changed: false }
  }

  if (!isRecord(payload)) return { request, changed: false }
  const sanitized = sanitizeRequestPayloadForCompat(payload)
  if (!sanitized.changed) return { request, changed: false }

  const headers = new Headers(request.headers)
  headers.set("content-type", "application/json")

  const sanitizedRequest = new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(sanitized.payload),
    redirect: request.redirect
  })

  return { request: sanitizedRequest, changed: true }
}

export async function CodexAuthPlugin(
  input: PluginInput,
  opts: CodexAuthPluginOptions = {}
): Promise<Hooks> {
  opts.log?.debug("codex-native init")
  const spoofMode: CodexSpoofMode =
    (opts.spoofMode as string | undefined) === "codex" ||
    (opts.spoofMode as string | undefined) === "strict"
      ? "codex"
      : "native"
  const runtimeMode: PluginRuntimeMode =
    opts.mode === "collab" || opts.mode === "codex" || opts.mode === "native"
      ? opts.mode
      : spoofMode === "codex"
        ? "codex"
        : "native"
  const collabModeEnabled = runtimeMode === "collab"
  const authMode: OpenAIAuthMode = modeForRuntimeMode(runtimeMode)
  const resolveCatalogHeaders = (): {
    originator: string
    userAgent: string
    openaiBeta?: string
  } => {
    const originator = resolveCodexOriginator(spoofMode)
    return {
      originator,
      userAgent: resolveRequestUserAgent(spoofMode, originator),
      ...(spoofMode === "native" ? { openaiBeta: "responses=experimental" } : {})
    }
  }
  const requestSnapshots = createRequestSnapshots({
    enabled: opts.headerSnapshots === true,
    log: opts.log
  })
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
    const auth = await loadAuthStorage()
    const snapshotUpdates: Record<string, ReturnType<CodexStatus["parseFromHeaders"]>> = {}
    for (const { mode, domain } of listOpenAIOAuthDomains(auth)) {
      for (let index = 0; index < domain.accounts.length; index += 1) {
        const account = domain.accounts[index]
        if (!account || account.enabled === false) continue

        hydrateAccountIdentityFromAccessClaims(account)

        let accessToken =
          typeof account.access === "string" && account.access.length > 0 ? account.access : undefined
        const now = Date.now()
        const expired =
          typeof account.expires === "number" &&
          Number.isFinite(account.expires) &&
          account.expires <= now

        if ((!accessToken || expired) && account.refresh) {
          try {
            await saveAuthStorage(undefined, async (authFile) => {
              const current = ensureOpenAIOAuthDomain(authFile, mode)
              const target = current.accounts[index]
              if (!target || target.enabled === false || !target.refresh) return authFile

              const tokens = await refreshAccessToken(target.refresh)
              const refreshedAt = Date.now()
              const claims = parseJwtClaims(tokens.id_token ?? tokens.access_token)

              target.refresh = tokens.refresh_token
              target.access = tokens.access_token
              target.expires = refreshedAt + (tokens.expires_in ?? 3600) * 1000
              target.accountId = extractAccountId(tokens) || target.accountId
              target.email = extractEmailFromClaims(claims) || target.email
              target.plan = extractPlanFromClaims(claims) || target.plan
              target.lastUsed = refreshedAt
              hydrateAccountIdentityFromAccessClaims(target)

              account.refresh = target.refresh
              account.access = target.access
              account.expires = target.expires
              account.accountId = target.accountId
              account.email = target.email
              account.plan = target.plan
              account.identityKey = target.identityKey
              accessToken = target.access

              return authFile
            })
          } catch (error) {
            opts.log?.debug("quota check refresh failed", {
              index,
              mode,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }

        if (!accessToken) continue

        if (!account.identityKey) {
          hydrateAccountIdentityFromAccessClaims(account)
        }
        if (!account.identityKey) continue

        const snapshot = await fetchQuotaSnapshotFromBackend({
          accessToken,
          accountId: account.accountId,
          now: Date.now(),
          modelFamily: "gpt-5.3-codex",
          userAgent: resolveRequestUserAgent(spoofMode, resolveCodexOriginator(spoofMode)),
          log: opts.log
        })
        if (!snapshot) continue

        snapshotUpdates[account.identityKey] = snapshot
      }
    }

    if (Object.keys(snapshotUpdates).length === 0) return

    await saveSnapshots(defaultSnapshotsPath(), (current) => ({
      ...current,
      ...snapshotUpdates
    }))
  }

  const runInteractiveAuthMenu = async (options: { allowExit: boolean }): Promise<"add" | "exit"> => {
    while (true) {
      const auth = await loadAuthStorage()
      const nativeDomain = getOpenAIOAuthDomain(auth, "native")
      const codexDomain = getOpenAIOAuthDomain(auth, "codex")
      const menuAccounts = buildAuthMenuAccounts({
        native: nativeDomain,
        codex: codexDomain,
        activeMode: authMode
      })
      const allowTransfer = await shouldOfferLegacyTransfer()

      const result = await runAuthMenuOnce({
        accounts: menuAccounts,
        allowTransfer,
        input: process.stdin,
        output: process.stdout,
        handlers: {
          onCheckQuotas: async () => {
            await refreshQuotaSnapshotsForAuthMenu()
            const report = await toolOutputForStatus()
            process.stdout.write(`\n${report}\n\n`)
          },
          onConfigureModels: async () => {
            process.stdout.write(
              "\nConfigure provider models in opencode.json and runtime flags in codex-config.json.\n\n"
            )
          },
          onTransfer: async () => {
            const transfer = await importLegacyInstallData()
            let total = transfer.imported
            let hydrated = 0
            let refreshed = 0
            await saveAuthStorage(undefined, async (authFile) => {
              for (const mode of ["native", "codex"] as const) {
                const domain = getOpenAIOAuthDomain(authFile, mode)
                if (!domain) continue

                for (const account of domain.accounts) {
                  const hadIdentity = Boolean(buildIdentityKey(account))
                  hydrateAccountIdentityFromAccessClaims(account)
                  const hasIdentityAfterClaims = Boolean(buildIdentityKey(account))
                  if (!hadIdentity && hasIdentityAfterClaims) hydrated += 1

                  if (hasIdentityAfterClaims || account.enabled === false || !account.refresh) {
                    continue
                  }

                  try {
                    const tokens = await refreshAccessToken(account.refresh)
                    refreshed += 1
                    const now = Date.now()
                    const claims = parseJwtClaims(tokens.id_token ?? tokens.access_token)
                    account.refresh = tokens.refresh_token
                    account.access = tokens.access_token
                    account.expires = now + (tokens.expires_in ?? 3600) * 1000
                    account.accountId = extractAccountId(tokens) || account.accountId
                    account.email = extractEmailFromClaims(claims) || account.email
                    account.plan = extractPlanFromClaims(claims) || account.plan
                    account.lastUsed = now
                    hydrateAccountIdentityFromAccessClaims(account)
                    if (!hadIdentity && buildIdentityKey(account)) hydrated += 1
                  } catch {
                    // best effort per-account hydration
                  }
                }
              }
              return authFile
            })
            process.stdout.write(
              `\nTransfer complete: imported ${total} account(s). Hydrated ${hydrated} account(s)` +
                `${refreshed > 0 ? `, refreshed ${refreshed} token(s)` : ""}.\n\n`
            )
          },
          onDeleteAll: async (scope) => {
            await saveAuthStorage(undefined, (authFile) => {
              const targets =
                scope === "both" ? (["native", "codex"] as const) : ([scope] as const)
              for (const targetMode of targets) {
                const domain = ensureOpenAIOAuthDomain(authFile, targetMode)
                domain.accounts = []
                domain.activeIdentityKey = undefined
              }
              return authFile
            })
            const deletedLabel =
              scope === "both"
                ? "Deleted all OpenAI accounts."
                : `Deleted ${scope === "native" ? "Native" : "Codex"} auth from all accounts.`
            process.stdout.write(`\n${deletedLabel}\n\n`)
          },
          onToggleAccount: async (account) => {
            await saveAuthStorage(undefined, (authFile) => {
              const authTypes: OpenAIAuthMode[] =
                account.authTypes && account.authTypes.length > 0
                  ? [...account.authTypes]
                  : ["native"]
              for (const mode of authTypes) {
                const domain = getOpenAIOAuthDomain(authFile, mode)
                if (!domain) continue
                const idx = findDomainAccountIndex(domain, account)
                if (idx < 0) continue
                const target = domain.accounts[idx]
                if (!target) continue
                target.enabled = target.enabled === false
                reconcileActiveIdentityKey(domain)
              }
              return authFile
            })
            process.stdout.write("\nUpdated account status.\n\n")
          },
          onRefreshAccount: async (account) => {
            let refreshed = false
            try {
              await saveAuthStorage(undefined, async (authFile) => {
                const preferred = [
                  authMode,
                  ...((account.authTypes ?? []).filter((mode) => mode !== authMode) as OpenAIAuthMode[])
                ]
                for (const mode of preferred) {
                  const domain = getOpenAIOAuthDomain(authFile, mode)
                  if (!domain) continue
                  const idx = findDomainAccountIndex(domain, account)
                  if (idx < 0) continue
                  const target = domain.accounts[idx]
                  if (!target || target.enabled === false || !target.refresh) continue
                  const tokens = await refreshAccessToken(target.refresh)
                  const now = Date.now()
                  const claims = parseJwtClaims(tokens.id_token ?? tokens.access_token)
                  target.refresh = tokens.refresh_token
                  target.access = tokens.access_token
                  target.expires = now + (tokens.expires_in ?? 3600) * 1000
                  target.accountId = extractAccountId(tokens) || target.accountId
                  target.email = extractEmailFromClaims(claims) || target.email
                  target.plan = extractPlanFromClaims(claims) || target.plan
                  target.lastUsed = now
                  ensureAccountAuthTypes(target)
                  ensureIdentityKey(target)
                  if (target.identityKey) domain.activeIdentityKey = target.identityKey
                  refreshed = true
                  break
                }
                return authFile
              })
            } catch {
              refreshed = false
            }
            process.stdout.write(
              refreshed
                ? "\nAccount refreshed successfully.\n\n"
                : "\nAccount refresh failed. Run login to reauthenticate.\n\n"
            )
          },
          onDeleteAccount: async (account, scope) => {
            await saveAuthStorage(undefined, (authFile) => {
              const targets =
                scope === "both" ? (["native", "codex"] as const) : ([scope] as const)
              for (const mode of targets) {
                const domain = getOpenAIOAuthDomain(authFile, mode)
                if (!domain) continue
                const idx = findDomainAccountIndex(domain, account)
                if (idx < 0) continue
                domain.accounts.splice(idx, 1)
                reconcileActiveIdentityKey(domain)
              }
              return authFile
            })
            const deletedLabel =
              scope === "both"
                ? "Deleted account."
                : `Deleted ${scope === "native" ? "Native" : "Codex"} auth from account.`
            process.stdout.write(`\n${deletedLabel}\n\n`)
          }
        }
      })

      if (result === "add") return "add"
      if (result === "exit") {
        if (options.allowExit) return "exit"
        continue
      }
    }
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

        const catalogAuth = await selectCatalogAuthCandidate(
          authMode,
          opts.pidOffsetEnabled === true
        )
        const catalogModels = await getCodexModelCatalog({
          accessToken: catalogAuth.accessToken,
          accountId: catalogAuth.accountId,
          ...resolveCatalogHeaders(),
          onEvent: (event) => opts.log?.debug("codex model catalog", event)
        })

        applyCodexCatalogToProviderModels({
          providerModels: provider.models as Record<string, Record<string, unknown>>,
          catalogModels,
          fallbackModels: STATIC_FALLBACK_MODELS,
          personality: opts.personality
        })

        const orchestratorState = createFetchOrchestratorState()
        const stickySessionState = createStickySessionState()

        return {
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: string | URL | Request, init?: RequestInit) {
            const baseRequest = new Request(requestInput, init)
            const outbound = new Request(rewriteUrl(baseRequest), baseRequest)
            const inboundOriginator = outbound.headers.get("originator")?.trim()
            const outboundOriginator =
              inboundOriginator === "codex_exec" || inboundOriginator === "codex_cli_rs"
                ? inboundOriginator
                : resolveCodexOriginator(spoofMode)
            outbound.headers.set("originator", outboundOriginator)
            outbound.headers.set(
              "user-agent",
              resolveRequestUserAgent(spoofMode, outboundOriginator)
            )
            const collaborationModeKind = outbound.headers.get(INTERNAL_COLLABORATION_MODE_HEADER)
            if (collaborationModeKind) {
              outbound.headers.delete(INTERNAL_COLLABORATION_MODE_HEADER)
            }
            let selectedIdentityKey: string | undefined

            await requestSnapshots.captureRequest("before-auth", outbound, {
              spoofMode,
              ...(collaborationModeKind ? { collaborationModeKind } : {})
            })

            const orchestrator = new FetchOrchestrator({
              acquireAuth: async (context) => {
                let access: string | undefined
                let accountId: string | undefined
                let identityKey: string | undefined
                let accountLabel: string | undefined
                let email: string | undefined
                let plan: string | undefined

                try {
                  await saveAuthStorage(undefined, async (authFile) => {
                    const now = Date.now()
                    const openai = authFile.openai
                    if (!openai || openai.type !== "oauth") {
                      throw new PluginFatalError({
                        message: "Not authenticated with OpenAI. Run `opencode auth login`.",
                        status: 401,
                        type: "oauth_not_configured",
                        param: "auth"
                      })
                    }

                    const domain = ensureOpenAIOAuthDomain(authFile, authMode)
                    if (domain.accounts.length === 0) {
                      throw new PluginFatalError({
                        message: `No OpenAI ${authMode} accounts configured. Run \`opencode auth login\`.`,
                        status: 401,
                        type: "no_accounts_configured",
                        param: "accounts"
                      })
                    }

                    const enabled = domain.accounts.filter((account) => account.enabled !== false)
                    if (enabled.length === 0) {
                      throw new PluginFatalError({
                        message: `No enabled OpenAI ${authMode} accounts available. Enable an account or run \`opencode auth login\`.`,
                        status: 403,
                        type: "no_enabled_accounts",
                        param: "accounts"
                      })
                    }

                    const attempted = new Set<string>()
                    let sawInvalidGrant = false
                    let sawRefreshFailure = false
                    let sawMissingRefresh = false
                    opts.log?.debug("rotation begin", {
                      strategy: domain.strategy ?? "sticky",
                      activeIdentityKey: domain.activeIdentityKey,
                      totalAccounts: domain.accounts.length,
                      enabledAccounts: enabled.length,
                      mode: authMode,
                      sessionKey: context?.sessionKey ?? null
                    })

                    while (attempted.size < domain.accounts.length) {
                      const selected = selectAccount({
                        accounts: domain.accounts,
                        strategy: domain.strategy,
                        activeIdentityKey: domain.activeIdentityKey,
                        now,
                        stickyPidOffset: opts.pidOffsetEnabled === true,
                        stickySessionKey: context?.sessionKey,
                        stickySessionState,
                        onDebug: (event) => {
                          opts.log?.debug("rotation decision", event)
                        }
                      })

                      if (!selected) {
                        opts.log?.debug("rotation stop: no selectable account", {
                          attempted: attempted.size,
                          totalAccounts: domain.accounts.length
                        })
                        break
                      }

                      const selectedIndex = domain.accounts.findIndex((account) => account === selected)
                      const attemptKey =
                        selected.identityKey ??
                        selected.refresh ??
                        (selectedIndex >= 0 ? `idx:${selectedIndex}` : `idx:${attempted.size}`)
                      if (attempted.has(attemptKey)) {
                        opts.log?.debug("rotation stop: duplicate attempt key", {
                          attemptKey,
                          selectedIdentityKey: selected.identityKey,
                          selectedIndex
                        })
                        break
                      }
                      attempted.add(attemptKey)
                      opts.log?.debug("rotation candidate selected", {
                        attemptKey,
                        selectedIdentityKey: selected.identityKey,
                        selectedIndex,
                        selectedEnabled: selected.enabled !== false,
                        selectedCooldownUntil: selected.cooldownUntil ?? null,
                        selectedExpires: selected.expires ?? null
                      })

                      accountLabel = formatAccountLabel(selected, selectedIndex >= 0 ? selectedIndex : 0)
                      email = selected.email
                      plan = selected.plan

                      if (selected.access && selected.expires && selected.expires > now) {
                        selected.lastUsed = now
                        access = selected.access
                        accountId = selected.accountId
                        identityKey = selected.identityKey
                        if (selected.identityKey) domain.activeIdentityKey = selected.identityKey
                        return authFile
                      }

                      if (!selected.refresh) {
                        sawMissingRefresh = true
                        selected.cooldownUntil = now + AUTH_REFRESH_FAILURE_COOLDOWN_MS
                        continue
                      }

                      let tokens: TokenResponse
                      try {
                        tokens = await refreshAccessToken(selected.refresh)
                      } catch (error) {
                        if (
                          isOAuthTokenRefreshError(error) &&
                          error.oauthCode?.toLowerCase() === "invalid_grant"
                        ) {
                          sawInvalidGrant = true
                          selected.enabled = false
                          delete selected.cooldownUntil
                          delete selected.refreshLeaseUntil
                          continue
                        }
                        sawRefreshFailure = true
                        selected.cooldownUntil = now + AUTH_REFRESH_FAILURE_COOLDOWN_MS
                        continue
                      }

                      const expires = now + (tokens.expires_in ?? 3600) * 1000
                      const refreshedAccountId = extractAccountId(tokens) || selected.accountId
                      const claims = parseJwtClaims(tokens.id_token ?? tokens.access_token)

                      selected.refresh = tokens.refresh_token
                      selected.access = tokens.access_token
                      selected.expires = expires
                      selected.accountId = refreshedAccountId
                      if (claims?.email) selected.email = normalizeEmail(claims.email)
                      if (claims?.plan) selected.plan = normalizePlan(claims.plan)
                      ensureIdentityKey(selected)
                      selected.lastUsed = now
                      accountLabel = formatAccountLabel(selected, selectedIndex >= 0 ? selectedIndex : 0)
                      email = selected.email
                      plan = selected.plan
                      identityKey = selected.identityKey
                      if (selected.identityKey) domain.activeIdentityKey = selected.identityKey

                      access = selected.access
                      accountId = selected.accountId

                      return authFile
                    }

                    const enabledAfterAttempts = domain.accounts.filter((account) => account.enabled !== false)
                    if (enabledAfterAttempts.length === 0 && sawInvalidGrant) {
                      throw new PluginFatalError({
                        message:
                          "All enabled OpenAI refresh tokens were rejected (invalid_grant). Run `opencode auth login` to reauthenticate.",
                        status: 401,
                        type: "refresh_invalid_grant",
                        param: "auth"
                      })
                    }

                    const nextAvailableAt = enabledAfterAttempts.reduce<number | undefined>(
                      (current, account) => {
                        const cooldownUntil = account.cooldownUntil
                        if (typeof cooldownUntil !== "number" || cooldownUntil <= now) return current
                        if (current === undefined || cooldownUntil < current) return cooldownUntil
                        return current
                      },
                      undefined
                    )
                    if (nextAvailableAt !== undefined) {
                      const waitMs = Math.max(0, nextAvailableAt - now)
                      throw new PluginFatalError({
                        message:
                          `All enabled OpenAI accounts are cooling down. Try again in ${formatWaitTime(waitMs)} or run \`opencode auth login\`.`,
                        status: 429,
                        type: "all_accounts_cooling_down",
                        param: "accounts"
                      })
                    }

                    if (sawInvalidGrant) {
                      throw new PluginFatalError({
                        message:
                          "OpenAI refresh token was rejected (invalid_grant). Run `opencode auth login` to reauthenticate this account.",
                        status: 401,
                        type: "refresh_invalid_grant",
                        param: "auth"
                      })
                    }

                    if (sawMissingRefresh) {
                      throw new PluginFatalError({
                        message:
                          "Selected OpenAI account is missing a refresh token. Run `opencode auth login` to reauthenticate.",
                        status: 401,
                        type: "missing_refresh_token",
                        param: "accounts"
                      })
                    }

                    if (sawRefreshFailure) {
                      throw new PluginFatalError({
                        message:
                          "Failed to refresh OpenAI access token. Run `opencode auth login` and try again.",
                        status: 401,
                        type: "refresh_failed",
                        param: "auth"
                      })
                    }

                    throw new PluginFatalError({
                      message:
                        `No enabled OpenAI ${authMode} accounts available. Enable an account or run \`opencode auth login\`.`,
                      status: 403,
                      type: "no_enabled_accounts",
                      param: "accounts"
                    })
                  })
                } catch (error) {
                  if (isPluginFatalError(error)) throw error
                  throw new PluginFatalError({
                    message:
                      "Unable to access OpenAI auth storage. Check plugin configuration and run `opencode auth login` if needed.",
                    status: 500,
                    type: "auth_storage_error",
                    param: "auth"
                  })
                }

                if (!access) {
                  throw new PluginFatalError({
                    message: "No valid OpenAI access token available. Run `opencode auth login`.",
                    status: 401,
                    type: "no_valid_access_token",
                    param: "auth"
                  })
                }

                void getCodexModelCatalog({
                  accessToken: access,
                  accountId,
                  ...resolveCatalogHeaders(),
                  onEvent: (event) => opts.log?.debug("codex model catalog", event)
                }).catch(() => {})

                selectedIdentityKey = identityKey
                return { access, accountId, identityKey, accountLabel, email, plan }
              },
              setCooldown: async (idKey, cooldownUntil) => {
                await setAccountCooldown(undefined, idKey, cooldownUntil, authMode)
              },
              quietMode: opts.quietMode === true,
              state: orchestratorState,
              showToast,
              onAttemptRequest: async ({ attempt, maxAttempts, request, auth, sessionKey }) => {
                await requestSnapshots.captureRequest("outbound-attempt", request, {
                  attempt: attempt + 1,
                  maxAttempts,
                  sessionKey,
                  identityKey: auth.identityKey,
                  accountLabel: auth.accountLabel,
                  ...(collaborationModeKind ? { collaborationModeKind } : {})
                })
              },
              onAttemptResponse: async ({ attempt, maxAttempts, response, auth, sessionKey }) => {
                await requestSnapshots.captureResponse("outbound-response", response, {
                  attempt: attempt + 1,
                  maxAttempts,
                  sessionKey,
                  identityKey: auth.identityKey,
                  accountLabel: auth.accountLabel,
                  ...(collaborationModeKind ? { collaborationModeKind } : {})
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
              sanitized: sanitizedOutbound.changed,
              ...(collaborationModeKind ? { collaborationModeKind } : {})
            })

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
          authorize: async (inputs?: Record<string, string>) => {
            const toOAuthSuccess = (tokens: TokenResponse) => ({
              type: "success" as const,
              refresh: tokens.refresh_token,
              access: tokens.access_token,
              expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
              accountId: extractAccountId(tokens)
            })

            const runSingleBrowserOAuthInline = async (): Promise<TokenResponse | null> => {
              const { redirectUri } = await startOAuthServer()
              const pkce = await generatePKCE()
              const state = generateState()
              const authUrl = buildAuthorizeUrl(
                redirectUri,
                pkce,
                state,
                "codex_cli_rs"
              )
              const callbackPromise = waitForOAuthCallback(pkce, state, authMode)
              void tryOpenUrlInBrowser(authUrl, opts.log)
              process.stdout.write(`\nGo to: ${authUrl}\n`)
              process.stdout.write("Complete authorization in your browser. This window will close automatically.\n")

              let authFailed = false
              try {
                const tokens = await callbackPromise
                await persistOAuthTokens(tokens)
                process.stdout.write("\nAccount added.\n\n")
                return tokens
              } catch (error) {
                authFailed = true
                const reason = error instanceof Error ? error.message : "Authorization failed"
                process.stdout.write(`\nAuthorization failed: ${reason}\n\n`)
                return null
              } finally {
                pendingOAuth = undefined
                scheduleOAuthServerStop(
                  authFailed ? OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS : OAUTH_SERVER_SHUTDOWN_GRACE_MS,
                  authFailed ? "error" : "success"
                )
              }
            }

            const runInteractiveBrowserAuthLoop = async () => {
              let lastAddedTokens: TokenResponse | undefined
              while (true) {
                const menuResult = await runInteractiveAuthMenu({ allowExit: true })
                if (menuResult === "exit") {
                  if (!lastAddedTokens) {
                    return {
                      url: "",
                      method: "auto" as const,
                      instructions: "Login cancelled.",
                      callback: async () => ({ type: "failed" as const })
                    }
                  }

                  const latest = lastAddedTokens
                  return {
                    url: "",
                    method: "auto" as const,
                    instructions: "",
                    callback: async () => toOAuthSuccess(latest)
                  }
                }

                const tokens = await runSingleBrowserOAuthInline()
                if (tokens) {
                  lastAddedTokens = tokens
                  continue
                }

                return {
                  url: "",
                  method: "auto" as const,
                  instructions: "Authorization failed.",
                  callback: async () => ({ type: "failed" as const })
                }
              }
            }

            if (
              inputs &&
              process.env.OPENCODE_NO_BROWSER !== "1" &&
              process.stdin.isTTY &&
              process.stdout.isTTY
            ) {
              return runInteractiveBrowserAuthLoop()
            }

            const { redirectUri } = await startOAuthServer()
            const pkce = await generatePKCE()
            const state = generateState()
            const authUrl = buildAuthorizeUrl(
              redirectUri,
              pkce,
              state,
              "codex_cli_rs"
            )
            const callbackPromise = waitForOAuthCallback(pkce, state, authMode)
            void tryOpenUrlInBrowser(authUrl, opts.log)

            return {
              url: authUrl,
              instructions:
                "Complete authorization in your browser. If you close the tab early, cancel (Ctrl+C) and retry.",
              method: "auto" as const,
              callback: async () => {
                let authFailed = false
                try {
                  const tokens = await callbackPromise
                  await persistOAuthTokens(tokens)
                  return toOAuthSuccess(tokens)
                } catch {
                  authFailed = true
                  return { type: "failed" as const }
                } finally {
                  pendingOAuth = undefined
                  scheduleOAuthServerStop(
                    authFailed ? OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS : OAUTH_SERVER_SHUTDOWN_GRACE_MS,
                    authFailed ? "error" : "success"
                  )
                }
              }
            }
          }
        },
        {
          label: "ChatGPT Pro/Plus (headless)",
          type: "oauth",
          authorize: async () => {
            const deviceResponse = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "User-Agent": resolveRequestUserAgent(spoofMode, resolveCodexOriginator(spoofMode))
              },
              body: JSON.stringify({ client_id: CLIENT_ID })
            })

            if (!deviceResponse.ok) {
              throw new Error("Failed to initiate device authorization")
            }

            const deviceData = (await deviceResponse.json()) as {
              device_auth_id: string
              user_code: string
              interval: string
            }

            const interval = Math.max(parseInt(deviceData.interval) || 5, 1) * 1000

            return {
              url: `${ISSUER}/codex/device`,
              instructions: `Enter code: ${deviceData.user_code}`,
              method: "auto" as const,
              async callback() {
                while (true) {
                  const response = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "User-Agent": resolveRequestUserAgent(spoofMode, resolveCodexOriginator(spoofMode))
                    },
                    body: JSON.stringify({
                      device_auth_id: deviceData.device_auth_id,
                      user_code: deviceData.user_code
                    })
                  })

                  if (response.ok) {
                    const data = (await response.json()) as {
                      authorization_code: string
                      code_verifier: string
                    }

                    const tokenResponse = await fetch(`${ISSUER}/oauth/token`, {
                      method: "POST",
                      headers: { "Content-Type": "application/x-www-form-urlencoded" },
                      body: new URLSearchParams({
                        grant_type: "authorization_code",
                        code: data.authorization_code,
                        redirect_uri: `${ISSUER}/deviceauth/callback`,
                        client_id: CLIENT_ID,
                        code_verifier: data.code_verifier
                      }).toString()
                    })

                    if (!tokenResponse.ok) {
                      throw new Error(`Token exchange failed: ${tokenResponse.status}`)
                    }

                    const tokens = (await tokenResponse.json()) as TokenResponse
                    await persistOAuthTokens(tokens)

                    return {
                      type: "success" as const,
                      refresh: tokens.refresh_token,
                      access: tokens.access_token,
                      expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                      accountId: extractAccountId(tokens)
                    }
                  }

                  if (response.status !== 403 && response.status !== 404) {
                    return { type: "failed" as const }
                  }

                  await sleep(interval + OAUTH_POLLING_SAFETY_MARGIN_MS)
                }
              }
            }
          }
        },
        {
          label: "Manually enter API Key",
          type: "api"
        }
      ]
    },
    "chat.message": async (hookInput, output) => {
      const directProviderID = hookInput.model?.providerID
      const isOpenAI = directProviderID === "openai"
        || (directProviderID === undefined
          && (await sessionUsesOpenAIProvider(input.client, hookInput.sessionID)))
      if (!isOpenAI) return

      for (const part of output.parts) {
        const partRecord = part as unknown as Record<string, unknown>
        if (asString(partRecord.type) !== "subtask") continue
        if ((asString(partRecord.command) ?? "").trim().toLowerCase() !== "review") continue
        partRecord.agent = "Codex Review"
      }
    },
    "chat.params": async (hookInput, output) => {
      if (hookInput.model.providerID !== "openai") return
      const initialReasoningEffort = asString(output.options.reasoningEffort)
      const collaborationProfile = collabModeEnabled
        ? resolveCollaborationProfile(hookInput.agent)
        : { enabled: false }
      const modelOptions = isRecord(hookInput.model.options) ? hookInput.model.options : {}
      const modelCandidates = getModelLookupCandidates({
        id: hookInput.model.id,
        api: { id: hookInput.model.api?.id }
      })
      const variantCandidates = getVariantLookupCandidates({
        message: hookInput.message,
        modelCandidates
      })
      const effectivePersonality = resolvePersonalityForModel({
        customSettings: opts.customSettings,
        modelCandidates,
        variantCandidates,
        fallback: opts.personality
      })
      const modelThinkingSummariesOverride = getModelThinkingSummariesOverride(
        opts.customSettings,
        modelCandidates,
        variantCandidates
      )
      if (asString(output.options.instructions) === undefined && isRecord(modelOptions.codexCatalogModel)) {
        const rendered = resolveInstructionsForModel(
          modelOptions.codexCatalogModel as CodexModelInfo,
          effectivePersonality
        )
        if (rendered) {
          modelOptions.codexInstructions = rendered
        }
      }
      applyCodexRuntimeDefaultsToParams({
        modelOptions,
        modelToolCallCapable: hookInput.model.capabilities?.toolcall,
        thinkingSummariesOverride:
          modelThinkingSummariesOverride ?? opts.customSettings?.thinkingSummaries,
        output
      })

      if (collabModeEnabled && collaborationProfile.enabled && collaborationProfile.kind) {
        const collaborationModeKind = collaborationProfile.kind
        const collaborationInstructions = resolveCollaborationInstructions(collaborationModeKind)
        const mergedInstructions = mergeInstructions(
          asString(output.options.instructions),
          collaborationInstructions
        )
        if (mergedInstructions) {
          output.options.instructions = mergedInstructions
        }
        if (initialReasoningEffort === undefined) {
          if (collaborationModeKind === "plan" || collaborationModeKind === "pair_programming") {
            output.options.reasoningEffort = "medium"
          } else if (collaborationModeKind === "execute") {
            output.options.reasoningEffort = "high"
          }
        }
      }
    },
    "chat.headers": async (hookInput, output) => {
      if (hookInput.model.providerID !== "openai") return
      const collaborationProfile = collabModeEnabled
        ? resolveCollaborationProfile(hookInput.agent)
        : { enabled: false }
      const collaborationModeKind = collaborationProfile.enabled ? collaborationProfile.kind : undefined
      const originator = resolveCodexOriginator(spoofMode)
      output.headers.originator = originator
      output.headers["User-Agent"] = resolveRequestUserAgent(spoofMode, originator)
      const modelOptions = isRecord(hookInput.model.options) ? hookInput.model.options : {}
      const promptCacheKey = resolvePromptCacheKey(modelOptions)
      if (spoofMode === "native") {
        output.headers["OpenAI-Beta"] = "responses=experimental"
        if (promptCacheKey) {
          output.headers.session_id = promptCacheKey
          output.headers.conversation_id = promptCacheKey
        } else {
          delete output.headers.session_id
          delete output.headers.conversation_id
        }
      } else {
        output.headers.session_id = promptCacheKey ?? hookInput.sessionID
        delete output.headers["OpenAI-Beta"]
        delete output.headers.conversation_id
        const subagentHeader = collaborationProfile.enabled ? resolveSubagentHeaderValue(hookInput.agent) : undefined
        if (subagentHeader) {
          output.headers["x-openai-subagent"] = subagentHeader
        } else {
          delete output.headers["x-openai-subagent"]
        }
        if (collaborationModeKind) {
          output.headers[INTERNAL_COLLABORATION_MODE_HEADER] = collaborationModeKind
        } else {
          delete output.headers[INTERNAL_COLLABORATION_MODE_HEADER]
        }
      }
    },
    "experimental.session.compacting": async (hookInput, output) => {
      if (await sessionUsesOpenAIProvider(input.client, hookInput.sessionID)) {
        output.prompt = CODEX_RS_COMPACT_PROMPT
      }
    }
  }

  async function persistOAuthTokens(tokens: TokenResponse): Promise<void> {
    const now = Date.now()
    const expires = now + (tokens.expires_in ?? 3600) * 1000
    const claims = parseJwtClaims(tokens.id_token ?? tokens.access_token)

    const account: AccountRecord = {
      enabled: true,
      refresh: tokens.refresh_token,
      access: tokens.access_token,
      expires,
      accountId: extractAccountId(tokens),
      email: extractEmailFromClaims(claims),
      plan: extractPlanFromClaims(claims),
      lastUsed: now
    }

    await saveAuthStorage(undefined, async (authFile) => {
      const domain = ensureOpenAIOAuthDomain(authFile, authMode)
      const stored = upsertAccount(domain, { ...account, authTypes: [authMode] })
      if (stored.identityKey) {
        domain.activeIdentityKey = stored.identityKey
      }
      return authFile
    })
  }
}
