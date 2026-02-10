export type RotationStrategy = "round_robin" | "sticky" | "hybrid"
export type AccountAuthType = "native" | "codex"
export type OpenAIAuthMode = "native" | "codex"

export type AccountRecord = {
  identityKey?: string
  accountId?: string
  email?: string
  plan?: string
  authTypes?: AccountAuthType[]
  enabled?: boolean
  access?: string
  refresh?: string
  expires?: number
  refreshLeaseUntil?: number
  cooldownUntil?: number
  lastUsed?: number
}

export type OpenAIOAuthDomain = {
  strategy?: RotationStrategy
  accounts: AccountRecord[]
  activeIdentityKey?: string
}

export type OpenAIMultiOauthAuth = {
  type: "oauth"
  /**
   * Compatibility aggregate view across auth domains.
   * Canonical storage lives in `native`/`codex`.
   */
  strategy?: RotationStrategy
  accounts: AccountRecord[]
  activeIdentityKey?: string
  native?: OpenAIOAuthDomain
  codex?: OpenAIOAuthDomain
}

export type AuthFile = {
  openai?:
    | OpenAIMultiOauthAuth
    | {
        type: "oauth"
        refresh: string
        access: string
        expires: number
        accountId?: string
        email?: string
        plan?: string
      }
}

export type CodexLimit = {
  name: string
  leftPct: number
  resetsAt?: number
  extra?: string
}

export type CodexRateLimitSnapshot = {
  updatedAt: number
  modelFamily: string
  limits: CodexLimit[]
  credits?: {
    hasCredits?: boolean
    unlimited?: boolean
    balance?: string
  }
}
