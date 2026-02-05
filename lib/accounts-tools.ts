import type { AccountRecord, OpenAIMultiOauthAuth } from "./types"

export type ToolAccountRow = {
  displayIndex: number // 1-based, matches tools
  identityKey: string
  email?: string
  plan?: string
  enabled: boolean
  isActive: boolean
}

export function listAccountsForTools(openai: OpenAIMultiOauthAuth): ToolAccountRow[] {
  return openai.accounts
    .filter((a): a is AccountRecord & { identityKey: string } => typeof a.identityKey === "string" && a.identityKey.length > 0)
    .map((a, i) => ({
      displayIndex: i + 1,
      identityKey: a.identityKey,
      email: a.email,
      plan: a.plan,
      enabled: a.enabled !== false,
      isActive: openai.activeIdentityKey === a.identityKey
    }))
}
