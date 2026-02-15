import {
  extractAccountIdFromClaims as extractAccountIdFromClaimsBase,
  parseJwtClaims,
  type IdTokenClaims
} from "../claims"
import type { CodexSpoofMode } from "../config"
import { CODEX_OAUTH_SUCCESS_HTML } from "../oauth-pages"

export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
export const ISSUER = "https://auth.openai.com"
export const OAUTH_PORT = resolvePortSetting(process.env.CODEX_OAUTH_PORT, 1455)
export const OAUTH_LOOPBACK_HOST = "localhost"
export const OAUTH_CALLBACK_ORIGIN = `http://${OAUTH_LOOPBACK_HOST}:${OAUTH_PORT}`
export const OAUTH_CALLBACK_PATH = "/auth/callback"
export const OAUTH_CALLBACK_URI = `${OAUTH_CALLBACK_ORIGIN}${OAUTH_CALLBACK_PATH}`
export const OAUTH_DUMMY_KEY = "oauth_dummy_key"
export const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000

function resolveTimeoutSetting(raw: string | undefined, fallbackMs: number, minMs: number): number {
  if (!raw) return fallbackMs
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= minMs ? parsed : fallbackMs
}

function resolvePortSetting(raw: string | undefined, fallbackPort: number): number {
  if (!raw) return fallbackPort
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallbackPort
  const rounded = Math.floor(parsed)
  if (rounded < 1 || rounded > 65535) return fallbackPort
  return rounded
}

// Timeout constants are resolved once at module load from process.env.
// Changes to environment variables after import are NOT reflected.
// This is acceptable because plugin configuration is set before launch.
export const OAUTH_HTTP_TIMEOUT_MS = resolveTimeoutSetting(process.env.CODEX_OAUTH_HTTP_TIMEOUT_MS, 15_000, 1_000)
export const OAUTH_DEVICE_AUTH_TIMEOUT_MS = resolveTimeoutSetting(
  process.env.CODEX_DEVICE_AUTH_TIMEOUT_MS,
  10 * 60 * 1000,
  1_000
)
export const OAUTH_CALLBACK_TIMEOUT_MS = resolveTimeoutSetting(
  process.env.CODEX_OAUTH_CALLBACK_TIMEOUT_MS,
  10 * 60 * 1000,
  60_000
)
export const OAUTH_SERVER_SHUTDOWN_GRACE_MS = resolveTimeoutSetting(
  process.env.CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS,
  2000,
  0
)
export const OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS = resolveTimeoutSetting(
  process.env.CODEX_OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS,
  60_000,
  0
)

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export type PkceCodes = {
  verifier: string
  challenge: string
}

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

export async function generatePKCE(): Promise<PkceCodes> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(64)))
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  const challenge = base64UrlEncode(new Uint8Array(hash))
  return { verifier, challenge }
}

export function generateState(): string {
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

export type OAuthTokenRefreshError = Error & {
  status?: number
  oauthCode?: string
}

export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.floor(timeoutMs)))
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`OAuth request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function buildAuthorizeUrl(
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

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  pkce: PkceCodes
): Promise<TokenResponse> {
  const response = await fetchWithTimeout(
    `${ISSUER}/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: CLIENT_ID,
        code_verifier: pkce.verifier
      }).toString()
    },
    OAUTH_HTTP_TIMEOUT_MS
  )

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`)
  }
  return (await response.json()) as TokenResponse
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const response = await fetchWithTimeout(
    `${ISSUER}/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID
      }).toString()
    },
    OAUTH_HTTP_TIMEOUT_MS
  )

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

export function composeCodexSuccessRedirectUrl(
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

export function buildOAuthSuccessHtml(mode: CodexSpoofMode = "codex"): string {
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

export function buildOAuthErrorHtml(error: string): string {
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
