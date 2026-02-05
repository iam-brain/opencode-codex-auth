export type RotationStrategy = "round_robin" | "sticky" | "hybrid"

export type AccountRecord = {
  identityKey?: string
  accountId?: string
  email?: string
  plan?: string
  enabled?: boolean
  access?: string
  refresh?: string
  expires?: number
  refreshLeaseUntil?: number
  cooldownUntil?: number
  lastUsed?: number
}

export type OpenAIMultiOauthAuth = {
  type: "oauth"
  strategy?: RotationStrategy
  accounts: AccountRecord[]
  activeIdentityKey?: string
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
}
