import type { Hooks, PluginInput } from "@opencode-ai/plugin"

import {
  extractAccountIdFromClaims as extractAccountIdFromClaimsBase,
  extractEmailFromClaims,
  extractPlanFromClaims,
  parseJwtClaims,
  type IdTokenClaims
} from "./claims"
import { CodexStatus, type HeaderMap } from "./codex-status"
import { loadSnapshots, saveSnapshots } from "./codex-status-storage"
import { PluginFatalError, formatWaitTime, isPluginFatalError, toSyntheticErrorResponse } from "./fatal-errors"
import { buildIdentityKey, ensureIdentityKey, normalizeEmail, normalizePlan, synchronizeIdentityKey } from "./identity"
import { defaultSessionAffinityPath, defaultSnapshotsPath } from "./paths"
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
  OpenAIOAuthDomain,
  RotationStrategy
} from "./types"
import { FetchOrchestrator, createFetchOrchestratorState } from "./fetch-orchestrator"
import type { CodexSpoofMode, CustomSettings, PersonalityOption, PluginRuntimeMode } from "./config"
import { formatToastMessage } from "./toast"
import { runAuthMenuOnce } from "./ui/auth-menu-runner"
import type { AccountInfo, DeleteScope } from "./ui/auth-menu"
import { shouldUseColor } from "./ui/tty/ansi"
import {
  applyCodexCatalogToProviderModels,
  getCodexModelCatalog,
  getRuntimeDefaultsForModel,
  resolveInstructionsForModel,
  type CodexModelInfo
} from "./model-catalog"
import { fetchQuotaSnapshotFromBackend } from "./codex-quota-fetch"
import { createRequestSnapshots } from "./request-snapshots"
import { CODEX_OAUTH_SUCCESS_HTML } from "./oauth-pages"
import {
  applyCatalogInstructionOverrideToRequest,
  applyCodexRuntimeDefaultsToParams,
  findCatalogModelForCandidates,
  getModelLookupCandidates,
  getModelThinkingSummariesOverride,
  getVariantLookupCandidates,
  remapDeveloperMessagesToUserOnRequest,
  resolvePersonalityForModel,
  sanitizeOutboundRequestIfNeeded
} from "./codex-native/request-transform"
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
export { browserOpenInvocationFor } from "./codex-native/browser"

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const OAUTH_PORT = 1455
const OAUTH_LOOPBACK_HOST = "127.0.0.1"
const OAUTH_CALLBACK_ORIGIN = `http://${OAUTH_LOOPBACK_HOST}:${OAUTH_PORT}`
const OAUTH_CALLBACK_PATH = "/auth/callback"
const OAUTH_CALLBACK_URI = `${OAUTH_CALLBACK_ORIGIN}${OAUTH_CALLBACK_PATH}`
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
const OPENAI_OUTBOUND_HOST_ALLOWLIST = new Set(["api.openai.com", "auth.openai.com", "chat.openai.com", "chatgpt.com"])
const AUTH_MENU_QUOTA_SNAPSHOT_TTL_MS = 60_000
const AUTH_MENU_QUOTA_FAILURE_COOLDOWN_MS = 30_000
const AUTH_MENU_QUOTA_FETCH_TIMEOUT_MS = 5000
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function tryOpenUrlInBrowser(url: string, log?: Logger): Promise<boolean> {
  return openUrlInBrowser({
    url,
    log,
    onEvent: (event, meta) => oauthServerController.emitDebug(event, meta ?? {})
  })
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
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)))
}

export function extractAccountIdFromClaims(claims: IdTokenClaims | undefined): string | undefined {
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
  resolveCodexClientVersion,
  refreshCodexClientVersionFromGitHub,
  isOAuthDebugEnabled,
  stopOAuthServer
}

async function exchangeCodeForTokens(code: string, redirectUri: string, pkce: PkceCodes): Promise<TokenResponse> {
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
    !getClaimBoolean(idClaims, "completed_platform_onboarding") && getClaimBoolean(idClaims, "is_org_owner")

  const platformUrl = issuer === ISSUER ? "https://platform.openai.com" : "https://platform.api.openai.org"

  const params = new URLSearchParams({
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

function removeAccountAuthType(existing: unknown, scope: Exclude<DeleteScope, "both">): AccountAuthType[] {
  return normalizeAccountAuthTypes(existing).filter((type) => type !== scope)
}

export function upsertAccount(openai: OpenAIOAuthDomain, incoming: AccountRecord): AccountRecord {
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

  synchronizeIdentityKey(target)
  if (!target.identityKey && strictIdentityKey) target.identityKey = strictIdentityKey

  return target
}

function rewriteUrl(requestInput: string | URL | Request): URL {
  const parsed =
    requestInput instanceof URL
      ? requestInput
      : new URL(typeof requestInput === "string" ? requestInput : requestInput.url)

  if (parsed.pathname.includes("/v1/responses") || parsed.pathname.includes("/chat/completions")) {
    return new URL(CODEX_API_ENDPOINT)
  }

  return parsed
}

function isAllowedOpenAIOutboundHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) return false
  if (OPENAI_OUTBOUND_HOST_ALLOWLIST.has(normalized)) return true
  return normalized.endsWith(".openai.com") || normalized.endsWith(".chatgpt.com")
}

function assertAllowedOutboundUrl(url: URL): void {
  const protocol = url.protocol.trim().toLowerCase()
  if (protocol !== "https:") {
    throw new PluginFatalError({
      message:
        `Blocked outbound request with unsupported protocol "${protocol || "unknown"}". ` +
        "This plugin only proxies HTTPS requests to OpenAI/ChatGPT backends.",
      status: 400,
      type: "disallowed_outbound_protocol",
      param: "request"
    })
  }

  if (isAllowedOpenAIOutboundHost(url.hostname)) return

  throw new PluginFatalError({
    message:
      `Blocked outbound request to "${url.hostname}". ` + "This plugin only proxies OpenAI/ChatGPT backend traffic.",
    status: 400,
    type: "disallowed_outbound_host",
    param: "request"
  })
}

async function sessionUsesOpenAIProvider(
  client: PluginInput["client"] | undefined,
  sessionID: string
): Promise<boolean> {
  const rows = await readSessionMessageRows(client, sessionID)
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (!isRecord(row) || !isRecord(row.info)) continue
    const info = row.info
    if (asString(info.role) !== "user") continue
    const providerID = getMessageProviderID(info)
    if (!providerID) continue
    return providerID === "openai"
  }

  return false
}

function getMessageProviderID(info: Record<string, unknown>): string | undefined {
  const model = isRecord(info.model) ? info.model : undefined
  return model ? asString(model.providerID) : asString(info.providerID)
}

async function readSessionMessageRows(
  client: PluginInput["client"] | undefined,
  sessionID: string
): Promise<unknown[]> {
  const sessionApi = client?.session as { messages: (input: unknown) => Promise<unknown> } | undefined
  if (!sessionApi || typeof sessionApi.messages !== "function") return []

  try {
    const response = await sessionApi.messages({ sessionID, limit: 100 })
    return isRecord(response) && Array.isArray(response.data) ? response.data : []
  } catch {
    return []
  }
}

async function readSessionMessageInfo(
  client: PluginInput["client"] | undefined,
  sessionID: string,
  messageID: string
): Promise<Record<string, unknown> | undefined> {
  const rows = await readSessionMessageRows(client, sessionID)
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (!isRecord(row) || !isRecord(row.info)) continue
    const info = row.info
    if (asString(info.id) !== messageID) continue
    return info
  }

  return undefined
}

function formatAccountLabel(
  account: { email?: string; plan?: string; accountId?: string } | undefined,
  index: number
): string {
  const email = account?.email?.trim()
  const plan = account?.plan?.trim()
  const accountId = account?.accountId?.trim()
  const idSuffix = accountId ? (accountId.length > 6 ? accountId.slice(-6) : accountId) : null

  if (email && plan) return `${email} (${plan})`
  if (email) return email
  if (idSuffix) return `id:${idSuffix}`
  return `Account ${index + 1}`
}

function hasActiveCooldown(account: AccountRecord, now: number): boolean {
  return (
    typeof account.cooldownUntil === "number" && Number.isFinite(account.cooldownUntil) && account.cooldownUntil > now
  )
}

function ensureAccountAuthTypes(account: AccountRecord): AccountAuthType[] {
  const normalized = normalizeAccountAuthTypes(account.authTypes)
  account.authTypes = normalized
  return normalized
}

function reconcileActiveIdentityKey(openai: OpenAIOAuthDomain): void {
  if (
    openai.activeIdentityKey &&
    openai.accounts.some((account) => account.identityKey === openai.activeIdentityKey && account.enabled !== false)
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
        : typeof account.expires === "number" && Number.isFinite(account.expires) && account.expires <= now
          ? "expired"
          : "unknown"

      if (!existing) {
        const isCurrentAccount =
          authMode === input.activeMode &&
          Boolean(domain.activeIdentityKey && account.identityKey === domain.activeIdentityKey)
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
      if (typeof account.lastUsed === "number" && (!existing.lastUsed || account.lastUsed > existing.lastUsed)) {
        existing.lastUsed = account.lastUsed
      }
      if (existing.enabled === false && account.enabled !== false) {
        existing.enabled = true
      }
      if (existing.status !== "rate-limited" && currentStatus === "rate-limited") {
        existing.status = "rate-limited"
      } else if (existing.status !== "rate-limited" && existing.status !== "expired" && currentStatus === "expired") {
        existing.status = "expired"
      }
      const isCurrentAccount =
        authMode === input.activeMode &&
        Boolean(domain.activeIdentityKey && account.identityKey === domain.activeIdentityKey)
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
    typeof account.access === "string" && account.access.length > 0 ? parseJwtClaims(account.access) : undefined
  if (!account.accountId) account.accountId = extractAccountIdFromClaims(claims)
  if (!account.email) account.email = extractEmailFromClaims(claims)
  if (!account.plan) account.plan = extractPlanFromClaims(claims)
  account.email = normalizeEmail(account.email)
  account.plan = normalizePlan(account.plan)
  if (account.accountId) account.accountId = account.accountId.trim()
  ensureAccountAuthTypes(account)
  synchronizeIdentityKey(account)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
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
  const codexCompactionOverrideEnabled = runtimeMode === "codex" && opts.codexCompactionOverride === true
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
    const auth = await loadAuthStorage()
    const snapshotPath = defaultSnapshotsPath()
    const existingSnapshots: Record<string, { updatedAt?: number }> = await loadSnapshots(snapshotPath).catch(
      () => ({})
    )
    const snapshotUpdates: Record<string, ReturnType<CodexStatus["parseFromHeaders"]>> = {}
    for (const { mode, domain } of listOpenAIOAuthDomains(auth)) {
      for (let index = 0; index < domain.accounts.length; index += 1) {
        const account = domain.accounts[index]
        if (!account || account.enabled === false) continue

        hydrateAccountIdentityFromAccessClaims(account)
        const identityKey = account.identityKey
        const now = Date.now()
        if (identityKey) {
          const cooldownUntil = quotaFetchCooldownByIdentity.get(identityKey)
          if (typeof cooldownUntil === "number" && cooldownUntil > now) continue
          const existing = existingSnapshots[identityKey]
          if (
            existing &&
            typeof existing.updatedAt === "number" &&
            Number.isFinite(existing.updatedAt) &&
            now - existing.updatedAt < AUTH_MENU_QUOTA_SNAPSHOT_TTL_MS
          ) {
            continue
          }
        }

        let accessToken = typeof account.access === "string" && account.access.length > 0 ? account.access : undefined
        const expired =
          typeof account.expires === "number" && Number.isFinite(account.expires) && account.expires <= now

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
            if (identityKey) {
              quotaFetchCooldownByIdentity.set(identityKey, Date.now() + AUTH_MENU_QUOTA_FAILURE_COOLDOWN_MS)
            }
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
          log: opts.log,
          timeoutMs: AUTH_MENU_QUOTA_FETCH_TIMEOUT_MS
        })
        if (!snapshot) {
          quotaFetchCooldownByIdentity.set(account.identityKey, Date.now() + AUTH_MENU_QUOTA_FAILURE_COOLDOWN_MS)
          continue
        }

        quotaFetchCooldownByIdentity.delete(account.identityKey)

        snapshotUpdates[account.identityKey] = snapshot
      }
    }

    if (Object.keys(snapshotUpdates).length === 0) return

    await saveSnapshots(snapshotPath, (current) => ({
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
            const report = await toolOutputForStatus(undefined, undefined, {
              style: "menu",
              useColor: shouldUseColor()
            })
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
              const targets = scope === "both" ? (["native", "codex"] as const) : ([scope] as const)
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
                account.authTypes && account.authTypes.length > 0 ? [...account.authTypes] : ["native"]
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
              const targets = scope === "both" ? (["native", "codex"] as const) : ([scope] as const)
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
            const instructionOverride = await applyCatalogInstructionOverrideToRequest({
              request: outbound,
              enabled: spoofMode === "codex",
              catalogModels: lastCatalogModels,
              customSettings: opts.customSettings,
              fallbackPersonality: opts.personality
            })
            const developerRoleRemap = await remapDeveloperMessagesToUserOnRequest({
              request: instructionOverride.request,
              enabled: remapDeveloperMessagesToUserEnabled
            })
            outbound = developerRoleRemap.request
            const subagentHeader = outbound.headers.get("x-openai-subagent")?.trim()
            const isSubagentRequest = Boolean(subagentHeader)
            if (opts.headerTransformDebug === true) {
              await requestSnapshots.captureRequest("after-header-transform", outbound, {
                spoofMode,
                instructionsOverridden: instructionOverride.changed,
                instructionOverrideReason: instructionOverride.reason,
                developerMessagesRemapped: developerRoleRemap.changed,
                developerMessageRemapReason: developerRoleRemap.reason,
                developerMessageRemapCount: developerRoleRemap.remappedCount,
                developerMessagePreservedCount: developerRoleRemap.preservedCount,
                ...(isSubagentRequest ? { subagent: subagentHeader } : {})
              })
            }
            let selectedIdentityKey: string | undefined

            await requestSnapshots.captureRequest("before-auth", outbound, { spoofMode })

            const orchestrator = new FetchOrchestrator({
              acquireAuth: async (context) => {
                let access: string | undefined
                let accountId: string | undefined
                let identityKey: string | undefined
                let accountLabel: string | undefined
                let email: string | undefined
                let plan: string | undefined

                try {
                  if (isSubagentRequest && context?.sessionKey) {
                    orchestratorState.seenSessionKeys.delete(context.sessionKey)
                    stickySessionState.bySessionKey.delete(context.sessionKey)
                    hybridSessionState.bySessionKey.delete(context.sessionKey)
                  }
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
                    const rotationStrategy: RotationStrategy = opts.rotationStrategy ?? domain.strategy ?? "sticky"
                    opts.log?.debug("rotation begin", {
                      strategy: rotationStrategy,
                      activeIdentityKey: domain.activeIdentityKey,
                      totalAccounts: domain.accounts.length,
                      enabledAccounts: enabled.length,
                      mode: authMode,
                      sessionKey: context?.sessionKey ?? null
                    })

                    while (attempted.size < domain.accounts.length) {
                      const sessionState =
                        rotationStrategy === "sticky"
                          ? stickySessionState
                          : rotationStrategy === "hybrid"
                            ? hybridSessionState
                            : undefined
                      const selected = selectAccount({
                        accounts: domain.accounts,
                        strategy: rotationStrategy,
                        activeIdentityKey: domain.activeIdentityKey,
                        now,
                        stickyPidOffset: opts.pidOffsetEnabled === true,
                        stickySessionKey: isSubagentRequest ? undefined : context?.sessionKey,
                        stickySessionState: sessionState,
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
                      if (!isSubagentRequest && context?.sessionKey && sessionState) {
                        persistSessionAffinityState()
                      }
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
                        if (isOAuthTokenRefreshError(error) && error.oauthCode?.toLowerCase() === "invalid_grant") {
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

                    const nextAvailableAt = enabledAfterAttempts.reduce<number | undefined>((current, account) => {
                      const cooldownUntil = account.cooldownUntil
                      if (typeof cooldownUntil !== "number" || cooldownUntil <= now) return current
                      if (current === undefined || cooldownUntil < current) return cooldownUntil
                      return current
                    }, undefined)
                    if (nextAvailableAt !== undefined) {
                      const waitMs = Math.max(0, nextAvailableAt - now)
                      throw new PluginFatalError({
                        message: `All enabled OpenAI accounts are cooling down. Try again in ${formatWaitTime(waitMs)} or run \`opencode auth login\`.`,
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
                        message: "Failed to refresh OpenAI access token. Run `opencode auth login` and try again.",
                        status: 401,
                        type: "refresh_failed",
                        param: "auth"
                      })
                    }

                    throw new PluginFatalError({
                      message: `No enabled OpenAI ${authMode} accounts available. Enable an account or run \`opencode auth login\`.`,
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

                if (spoofMode === "codex") {
                  const shouldAwaitCatalog = !lastCatalogModels || lastCatalogModels.length === 0
                  if (shouldAwaitCatalog) {
                    try {
                      await syncCatalogFromAuth({ accessToken: access, accountId })
                    } catch {
                      // best-effort catalog load; request can still proceed
                    }
                  } else {
                    void syncCatalogFromAuth({ accessToken: access, accountId }).catch(() => {})
                  }
                } else {
                  void syncCatalogFromAuth({ accessToken: access, accountId }).catch(() => {})
                }

                selectedIdentityKey = identityKey
                return { access, accountId, identityKey, accountLabel, email, plan }
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
                const instructionOverride = await applyCatalogInstructionOverrideToRequest({
                  request,
                  enabled: spoofMode === "codex",
                  catalogModels: lastCatalogModels,
                  customSettings: opts.customSettings,
                  fallbackPersonality: opts.personality
                })
                const developerRoleRemap = await remapDeveloperMessagesToUserOnRequest({
                  request: instructionOverride.request,
                  enabled: remapDeveloperMessagesToUserEnabled
                })
                await requestSnapshots.captureRequest("outbound-attempt", developerRoleRemap.request, {
                  attempt: attempt + 1,
                  maxAttempts,
                  sessionKey,
                  identityKey: auth.identityKey,
                  accountLabel: auth.accountLabel,
                  instructionsOverridden: instructionOverride.changed,
                  instructionOverrideReason: instructionOverride.reason,
                  developerMessagesRemapped: developerRoleRemap.changed,
                  developerMessageRemapReason: developerRoleRemap.reason,
                  developerMessageRemapCount: developerRoleRemap.remappedCount,
                  developerMessagePreservedCount: developerRoleRemap.preservedCount
                })
                return developerRoleRemap.request
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
                spoofMode === "codex" ? "codex_cli_rs" : "opencode"
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

            if (inputs && process.env.OPENCODE_NO_BROWSER !== "1" && process.stdin.isTTY && process.stdout.isTTY) {
              return runInteractiveBrowserAuthLoop()
            }

            const { redirectUri } = await startOAuthServer()
            const pkce = await generatePKCE()
            const state = generateState()
            const authUrl = buildAuthorizeUrl(
              redirectUri,
              pkce,
              state,
              spoofMode === "codex" ? "codex_cli_rs" : "opencode"
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
      const isOpenAI =
        directProviderID === "openai" ||
        (directProviderID === undefined && (await sessionUsesOpenAIProvider(input.client, hookInput.sessionID)))
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
      const modelOptions = isRecord(hookInput.model.options) ? hookInput.model.options : {}
      const modelCandidates = getModelLookupCandidates({
        id: hookInput.model.id,
        api: { id: hookInput.model.api?.id }
      })
      const variantCandidates = getVariantLookupCandidates({
        message: hookInput.message,
        modelCandidates
      })
      const catalogModelFallback = findCatalogModelForCandidates(lastCatalogModels, modelCandidates)
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
      if (isRecord(modelOptions.codexCatalogModel)) {
        const rendered = resolveInstructionsForModel(
          modelOptions.codexCatalogModel as CodexModelInfo,
          effectivePersonality
        )
        if (rendered) {
          modelOptions.codexInstructions = rendered
        } else {
          delete modelOptions.codexInstructions
        }
      } else if (catalogModelFallback) {
        modelOptions.codexCatalogModel = catalogModelFallback
        const rendered = resolveInstructionsForModel(catalogModelFallback, effectivePersonality)
        if (rendered) {
          modelOptions.codexInstructions = rendered
        } else {
          delete modelOptions.codexInstructions
        }
        const defaults = getRuntimeDefaultsForModel(catalogModelFallback)
        if (defaults) {
          modelOptions.codexRuntimeDefaults = defaults
        }
      } else if (asString(modelOptions.codexInstructions) === undefined) {
        const directModelInstructions = asString((hookInput.model as Record<string, unknown>).instructions)
        if (directModelInstructions) {
          modelOptions.codexInstructions = directModelInstructions
        }
      }
      applyCodexRuntimeDefaultsToParams({
        modelOptions,
        modelToolCallCapable: hookInput.model.capabilities?.toolcall,
        thinkingSummariesOverride: modelThinkingSummariesOverride ?? opts.customSettings?.thinkingSummaries,
        preferCodexInstructions: spoofMode === "codex",
        output
      })
    },
    "chat.headers": async (hookInput, output) => {
      if (hookInput.model.providerID !== "openai") return
      const originator = resolveCodexOriginator(spoofMode)
      output.headers.originator = originator
      output.headers["User-Agent"] = resolveRequestUserAgent(spoofMode, originator)
      if (spoofMode === "native") {
        output.headers.session_id = hookInput.sessionID
        delete output.headers["OpenAI-Beta"]
        delete output.headers.conversation_id
      } else {
        output.headers.session_id = hookInput.sessionID
        delete output.headers["OpenAI-Beta"]
        delete output.headers.conversation_id
        delete output.headers["x-openai-subagent"]
        delete output.headers[INTERNAL_COLLABORATION_MODE_HEADER]
      }
    },
    "experimental.session.compacting": async (hookInput, output) => {
      if (!codexCompactionOverrideEnabled) return
      if (await sessionUsesOpenAIProvider(input.client, hookInput.sessionID)) {
        output.prompt = CODEX_RS_COMPACT_PROMPT
        codexCompactionSummaryPrefixSessions.add(hookInput.sessionID)
      }
    },
    "experimental.text.complete": async (hookInput, output) => {
      if (!codexCompactionOverrideEnabled) return
      if (!codexCompactionSummaryPrefixSessions.has(hookInput.sessionID)) return

      const info = await readSessionMessageInfo(input.client, hookInput.sessionID, hookInput.messageID)
      codexCompactionSummaryPrefixSessions.delete(hookInput.sessionID)
      if (!info) return
      if (asString(info.role) !== "assistant") return
      if (asString(info.agent) !== "compaction") return
      if (info.summary !== true) return
      if (getMessageProviderID(info) !== "openai") return
      if (output.text.startsWith(CODEX_RS_COMPACT_SUMMARY_PREFIX)) return

      output.text = `${CODEX_RS_COMPACT_SUMMARY_PREFIX}\n${output.text.trimStart()}`
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
