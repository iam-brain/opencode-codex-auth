import type { CodexSpoofMode } from "../config"
import type { OpenAIAuthMode } from "../types"
import { resolveRequestUserAgent } from "./client-identity"
import { resolveCodexOriginator } from "./originator"
import {
  buildAuthorizeUrl,
  CLIENT_ID,
  extractAccountId,
  fetchWithTimeout,
  generatePKCE,
  generateState,
  ISSUER,
  OAUTH_DEVICE_AUTH_TIMEOUT_MS,
  OAUTH_HTTP_TIMEOUT_MS,
  OAUTH_POLLING_SAFETY_MARGIN_MS,
  sleep,
  type PkceCodes,
  type TokenResponse
} from "./oauth-utils"

type OAuthSuccess = {
  type: "success"
  refresh: string
  access: string
  expires: number
  accountId?: string
}

type OAuthFailure = {
  type: "failed"
}

type OAuthCallbackResult = OAuthSuccess | OAuthFailure

type OAuthAuthorizePayload = {
  url: string
  instructions: string
  method: "auto"
  callback: () => Promise<OAuthCallbackResult>
}

type AuthMenuResult = "add" | "exit"

type BrowserAuthorizeDeps = {
  authMode: OpenAIAuthMode
  spoofMode: CodexSpoofMode
  runInteractiveAuthMenu: (options: { allowExit: boolean }) => Promise<AuthMenuResult>
  startOAuthServer: () => Promise<{ redirectUri: string }>
  waitForOAuthCallback: (pkce: PkceCodes, state: string, authMode: OpenAIAuthMode) => Promise<TokenResponse>
  scheduleOAuthServerStop: (delayMs: number, reason: "success" | "error" | "other") => void
  persistOAuthTokens: (tokens: TokenResponse) => Promise<void>
  openAuthUrl: (url: string) => void
  shutdownGraceMs: number
  shutdownErrorGraceMs: number
}

type HeadlessAuthorizeDeps = {
  spoofMode: CodexSpoofMode
  persistOAuthTokens: (tokens: TokenResponse) => Promise<void>
}

function resolveDeviceAuthUserAgent(spoofMode: CodexSpoofMode): string {
  const originator = resolveCodexOriginator(spoofMode)
  const userAgent = resolveRequestUserAgent(spoofMode, originator)
  if (spoofMode !== "native") return userAgent
  const prefix = userAgent.split(" ", 1)[0]
  return prefix || userAgent
}

function toOAuthSuccess(tokens: TokenResponse): OAuthSuccess {
  return {
    type: "success",
    refresh: tokens.refresh_token,
    access: tokens.access_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    accountId: extractAccountId(tokens)
  }
}

export function createBrowserOAuthAuthorize(deps: BrowserAuthorizeDeps) {
  return async (inputs?: Record<string, string>): Promise<OAuthAuthorizePayload> => {
    const runSingleBrowserOAuthInline = async (): Promise<TokenResponse | null> => {
      const { redirectUri } = await deps.startOAuthServer()
      const pkce = await generatePKCE()
      const state = generateState()
      const authUrl = buildAuthorizeUrl(
        redirectUri,
        pkce,
        state,
        deps.spoofMode === "codex" ? "codex_cli_rs" : "opencode"
      )
      const callbackPromise = deps.waitForOAuthCallback(pkce, state, deps.authMode)
      deps.openAuthUrl(authUrl)
      process.stdout.write(`\nGo to: ${authUrl}\n`)
      process.stdout.write("Complete authorization in your browser. This window will close automatically.\n")

      let authFailed = false
      try {
        const tokens = await callbackPromise
        await deps.persistOAuthTokens(tokens)
        process.stdout.write("\nAccount added.\n\n")
        return tokens
      } catch (error) {
        authFailed = true
        const reason = error instanceof Error ? error.message : "Authorization failed"
        process.stdout.write(`\nAuthorization failed: ${reason}\n\n`)
        return null
      } finally {
        deps.scheduleOAuthServerStop(
          authFailed ? deps.shutdownErrorGraceMs : deps.shutdownGraceMs,
          authFailed ? "error" : "success"
        )
      }
    }

    const runInteractiveBrowserAuthLoop = async (): Promise<OAuthAuthorizePayload> => {
      let lastAddedTokens: TokenResponse | undefined
      while (true) {
        const menuResult = await deps.runInteractiveAuthMenu({ allowExit: true })
        if (menuResult === "exit") {
          if (!lastAddedTokens) {
            return {
              url: "",
              method: "auto",
              instructions: "Login cancelled.",
              callback: async () => ({ type: "failed" })
            }
          }

          const latest = lastAddedTokens
          return {
            url: "",
            method: "auto",
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
          method: "auto",
          instructions: "Authorization failed.",
          callback: async () => ({ type: "failed" })
        }
      }
    }

    if (inputs && process.env.OPENCODE_NO_BROWSER !== "1" && process.stdin.isTTY && process.stdout.isTTY) {
      return runInteractiveBrowserAuthLoop()
    }

    const { redirectUri } = await deps.startOAuthServer()
    const pkce = await generatePKCE()
    const state = generateState()
    const authUrl = buildAuthorizeUrl(
      redirectUri,
      pkce,
      state,
      deps.spoofMode === "codex" ? "codex_cli_rs" : "opencode"
    )
    const callbackPromise = deps.waitForOAuthCallback(pkce, state, deps.authMode)
    deps.openAuthUrl(authUrl)

    return {
      url: authUrl,
      instructions: "Complete authorization in your browser. If you close the tab early, cancel (Ctrl+C) and retry.",
      method: "auto",
      callback: async () => {
        let authFailed = false
        try {
          const tokens = await callbackPromise
          await deps.persistOAuthTokens(tokens)
          return toOAuthSuccess(tokens)
        } catch {
          authFailed = true
          return { type: "failed" }
        } finally {
          deps.scheduleOAuthServerStop(
            authFailed ? deps.shutdownErrorGraceMs : deps.shutdownGraceMs,
            authFailed ? "error" : "success"
          )
        }
      }
    }
  }
}

export function createHeadlessOAuthAuthorize(deps: HeadlessAuthorizeDeps) {
  return async (): Promise<OAuthAuthorizePayload> => {
    const deviceResponse = await fetchWithTimeout(
      `${ISSUER}/api/accounts/deviceauth/usercode`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": resolveDeviceAuthUserAgent(deps.spoofMode)
        },
        body: JSON.stringify({ client_id: CLIENT_ID })
      },
      OAUTH_HTTP_TIMEOUT_MS
    )

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
      method: "auto",
      async callback() {
        const startedAt = Date.now()
        while (true) {
          if (Date.now() - startedAt > OAUTH_DEVICE_AUTH_TIMEOUT_MS) {
            return { type: "failed" }
          }

          const response = await fetchWithTimeout(
            `${ISSUER}/api/accounts/deviceauth/token`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "User-Agent": resolveDeviceAuthUserAgent(deps.spoofMode)
              },
              body: JSON.stringify({
                device_auth_id: deviceData.device_auth_id,
                user_code: deviceData.user_code
              })
            },
            OAUTH_HTTP_TIMEOUT_MS
          )

          if (response.ok) {
            const data = (await response.json()) as {
              authorization_code: string
              code_verifier: string
            }

            const tokenResponse = await fetchWithTimeout(
              `${ISSUER}/oauth/token`,
              {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  grant_type: "authorization_code",
                  code: data.authorization_code,
                  redirect_uri: `${ISSUER}/deviceauth/callback`,
                  client_id: CLIENT_ID,
                  code_verifier: data.code_verifier
                }).toString()
              },
              OAUTH_HTTP_TIMEOUT_MS
            )

            if (!tokenResponse.ok) {
              throw new Error(`Token exchange failed: ${tokenResponse.status}`)
            }

            const tokens = (await tokenResponse.json()) as TokenResponse
            await deps.persistOAuthTokens(tokens)
            return toOAuthSuccess(tokens)
          }

          if (response.status !== 403 && response.status !== 404) {
            return { type: "failed" }
          }

          await sleep(interval + OAUTH_POLLING_SAFETY_MARGIN_MS)
        }
      }
    }
  }
}
