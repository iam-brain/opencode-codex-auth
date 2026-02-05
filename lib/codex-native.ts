import type { Hooks, PluginInput } from "@opencode-ai/plugin"

import http from "node:http"
import os from "node:os"

import { parseJwtClaims, type IdTokenClaims } from "./claims"
import { buildIdentityKey, ensureIdentityKey, normalizeEmail, normalizePlan } from "./identity"
import { selectAccount } from "./rotation"
import { saveAuthStorage, setAccountCooldown } from "./storage"
import type { AccountRecord, AuthFile, OpenAIMultiOauthAuth } from "./types"
import { FetchOrchestrator } from "./fetch-orchestrator"

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const OAUTH_PORT = 1455
const OAUTH_DUMMY_KEY = "oauth_dummy_key"
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
  const verifier = generateRandomString(43)
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  const challenge = base64UrlEncode(new Uint8Array(hash))
  return { verifier, challenge }
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("")
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
  if (!claims) return undefined
  return (
    claims.chatgpt_account_id ||
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  )
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

function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "opencode"
  })
  return `${ISSUER}/oauth/authorize?${params.toString()}`
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
    throw new Error(`Token refresh failed: ${response.status}`)
  }
  return (await response.json()) as TokenResponse
}

const HTML_SUCCESS = `<!doctype html>
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

const HTML_ERROR = (error: string) => `<!doctype html>
<html>
  <head>
    <title>OpenCode - Codex Authorization Failed</title>
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
      <h1>Authorization Failed</h1>
      <p>An error occurred during authorization.</p>
      <div class="error">${escapeHtml(error)}</div>
    </div>
  </body>
</html>`

type PendingOAuth = {
  pkce: PkceCodes
  state: string
  resolve: (tokens: TokenResponse) => void
  reject: (error: Error) => void
}

let oauthServer: http.Server | undefined
let pendingOAuth: PendingOAuth | undefined

async function startOAuthServer(): Promise<{ redirectUri: string }> {
  if (oauthServer) {
    return { redirectUri: `http://localhost:${OAUTH_PORT}/auth/callback` }
  }

  oauthServer = http.createServer((req, res) => {
    try {
      const base = `http://${req.headers.host ?? `localhost:${OAUTH_PORT}`}`
      const url = new URL(req.url ?? "/", base)

      const sendHtml = (status: number, html: string) => {
        res.statusCode = status
        res.setHeader("Content-Type", "text/html")
        res.end(html)
      }

      if (url.pathname === "/auth/callback") {
        const code = url.searchParams.get("code")
        const state = url.searchParams.get("state")
        const error = url.searchParams.get("error")
        const errorDescription = url.searchParams.get("error_description")

        if (error) {
          const errorMsg = errorDescription || error
          pendingOAuth?.reject(new Error(errorMsg))
          pendingOAuth = undefined
          sendHtml(200, HTML_ERROR(errorMsg))
          return
        }

        if (!code) {
          const errorMsg = "Missing authorization code"
          pendingOAuth?.reject(new Error(errorMsg))
          pendingOAuth = undefined
          sendHtml(400, HTML_ERROR(errorMsg))
          return
        }

        if (!pendingOAuth || state !== pendingOAuth.state) {
          const errorMsg = "Invalid state - potential CSRF attack"
          pendingOAuth?.reject(new Error(errorMsg))
          pendingOAuth = undefined
          sendHtml(400, HTML_ERROR(errorMsg))
          return
        }

        const current = pendingOAuth
        pendingOAuth = undefined
        exchangeCodeForTokens(code, `http://localhost:${OAUTH_PORT}/auth/callback`, current.pkce)
          .then((tokens) => current.resolve(tokens))
          .catch((err) => current.reject(err))

        sendHtml(200, HTML_SUCCESS)
        return
      }

      if (url.pathname === "/cancel") {
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
      oauthServer?.listen(OAUTH_PORT, "localhost", () => resolve())
    })
  } catch (error) {
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
  oauthServer?.close()
  oauthServer = undefined
}

function waitForOAuthCallback(pkce: PkceCodes, state: string): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingOAuth) {
        pendingOAuth = undefined
        reject(new Error("OAuth callback timeout - authorization took too long"))
      }
    }, 5 * 60 * 1000)

    pendingOAuth = {
      pkce,
      state,
      resolve: (tokens) => {
        clearTimeout(timeout)
        resolve(tokens)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    }
  })
}

function ensureOpenAIMultiAuth(auth: AuthFile): OpenAIMultiOauthAuth {
  const current = auth.openai
  if (current && current.type === "oauth" && "accounts" in current) {
    return current
  }
  const next: OpenAIMultiOauthAuth = {
    type: "oauth",
    accounts: [],
    ...(current && current.type === "oauth" && "strategy" in current
      ? { strategy: current.strategy }
      : null)
  }
  auth.openai = next
  return next
}

function upsertAccount(openai: OpenAIMultiOauthAuth, incoming: AccountRecord): AccountRecord {
  const normalizedEmail = normalizeEmail(incoming.email)
  const normalizedPlan = normalizePlan(incoming.plan)
  const computedIdentityKey = buildIdentityKey({
    accountId: incoming.accountId,
    email: normalizedEmail,
    plan: normalizedPlan
  })

  const match = openai.accounts.find((existing) => {
    if (existing.enabled === false) return false
    if (computedIdentityKey && existing.identityKey === computedIdentityKey) return true
    if (incoming.identityKey && existing.identityKey === incoming.identityKey) return true
    if (incoming.refresh && existing.refresh === incoming.refresh) return true
    if (incoming.accountId && existing.accountId === incoming.accountId) return true
    if (normalizedEmail && normalizeEmail(existing.email) === normalizedEmail) return true
    return false
  })

  const target = match ?? ({} as AccountRecord)
  if (!match) {
    openai.accounts.push(target)
  }

  if (incoming.enabled !== undefined) target.enabled = incoming.enabled
  if (incoming.refresh) target.refresh = incoming.refresh
  if (incoming.access) target.access = incoming.access
  if (incoming.expires !== undefined) target.expires = incoming.expires
  if (incoming.accountId) target.accountId = incoming.accountId
  if (normalizedEmail) target.email = normalizedEmail
  if (normalizedPlan) target.plan = normalizedPlan
  if (incoming.lastUsed !== undefined) target.lastUsed = incoming.lastUsed

  ensureIdentityKey(target)
  if (!target.identityKey && computedIdentityKey) target.identityKey = computedIdentityKey

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
  return `opencode-openai-multi ( ${os.platform()} ${os.release()}; ${os.arch()} )`
}

export async function CodexAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "openai",
      async loader(getAuth, provider) {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}

        const allowedModels = new Set([
          "gpt-5.1-codex-max",
          "gpt-5.1-codex-mini",
          "gpt-5.2",
          "gpt-5.2-codex",
          "gpt-5.1-codex"
        ])

        for (const modelId of Object.keys(provider.models)) {
          if (!allowedModels.has(modelId)) {
            delete provider.models[modelId]
          }
        }

        for (const model of Object.values(provider.models)) {
          model.cost = {
            input: 0,
            output: 0,
            cache: { read: 0, write: 0 }
          }
        }

        return {
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(requestInput: string | URL | Request, init?: RequestInit) {
            const baseRequest = new Request(requestInput, init)
            const outbound = new Request(rewriteUrl(baseRequest), baseRequest)

            const orchestrator = new FetchOrchestrator({
              acquireAuth: async () => {
                let access: string | undefined
                let accountId: string | undefined
                let identityKey: string | undefined

                await saveAuthStorage(undefined, async (authFile) => {
                  const now = Date.now()
                  const openai = authFile.openai
                  if (!openai || openai.type !== "oauth") {
                    throw new Error("OpenAI OAuth not configured")
                  }

                  const multi = ensureOpenAIMultiAuth(authFile)

                  const selected = selectAccount({
                    accounts: multi.accounts,
                    strategy: multi.strategy,
                    activeIdentityKey: multi.activeIdentityKey,
                    now
                  })

                  if (!selected) {
                    throw new Error(
                      "No enabled OpenAI accounts available (check enabled/cooldown settings)"
                    )
                  }

                  if (selected.access && selected.expires && selected.expires > now) {
                    selected.lastUsed = now
                    access = selected.access
                    accountId = selected.accountId
                    identityKey = selected.identityKey
                    if (selected.identityKey) multi.activeIdentityKey = selected.identityKey
                    return authFile
                  }

                  if (!selected.refresh) {
                    throw new Error("Selected account missing refresh token")
                  }

                  const tokens = await refreshAccessToken(selected.refresh)
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
                  identityKey = selected.identityKey
                  if (selected.identityKey) multi.activeIdentityKey = selected.identityKey

                  access = selected.access
                  accountId = selected.accountId

                  return authFile
                })

                if (!access) {
                  throw new Error("Failed to acquire OpenAI access token")
                }

                return { access, accountId, identityKey }
              },
              setCooldown: async (idKey, cooldownUntil) => {
                await setAccountCooldown(undefined, idKey, cooldownUntil)
              }
            })

            return orchestrator.execute(outbound)
          }
        }
      },
      methods: [
        {
          label: "ChatGPT Pro/Plus (browser)",
          type: "oauth",
          authorize: async () => {
            const { redirectUri } = await startOAuthServer()
            const pkce = await generatePKCE()
            const state = generateState()
            const authUrl = buildAuthorizeUrl(redirectUri, pkce, state)
            const callbackPromise = waitForOAuthCallback(pkce, state)

            return {
              url: authUrl,
              instructions:
                "Complete authorization in your browser. This window will close automatically.",
              method: "auto" as const,
              callback: async () => {
                try {
                  const tokens = await callbackPromise
                  await persistOAuthTokens(tokens)
                  return {
                    type: "success" as const,
                    refresh: tokens.refresh_token,
                    access: tokens.access_token,
                    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                    accountId: extractAccountId(tokens)
                  }
                } catch {
                  return { type: "failed" as const }
                } finally {
                  pendingOAuth = undefined
                  stopOAuthServer()
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
                "User-Agent": opencodeUserAgent()
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
                      "User-Agent": opencodeUserAgent()
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
    "chat.headers": async (hookInput, output) => {
      if (hookInput.model.providerID !== "openai") return
      output.headers.originator = "opencode"
      output.headers["User-Agent"] = opencodeUserAgent()
      output.headers.session_id = hookInput.sessionID
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
      email: claims?.email,
      plan: claims?.plan,
      lastUsed: now
    }

    await saveAuthStorage(undefined, async (authFile) => {
      const openai = ensureOpenAIMultiAuth(authFile)
      const stored = upsertAccount(openai, account)
      if (stored.identityKey) {
        openai.activeIdentityKey = stored.identityKey
      }
      return authFile
    })
  }
}
