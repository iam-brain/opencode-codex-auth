import type { OpenAIAuthMode } from "../types.js"

export type OAuthServerStopReason = "success" | "error" | "other"

export type OAuthServerControllerInput<TPkce, TTokens> = {
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

export type PendingOAuth<TPkce, TTokens> = {
  pkce: TPkce
  state: string
  authMode: OpenAIAuthMode
  resolve: (tokens: TTokens) => void
  reject: (error: Error) => void
}
