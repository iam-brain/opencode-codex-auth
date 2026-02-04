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
      }
}
