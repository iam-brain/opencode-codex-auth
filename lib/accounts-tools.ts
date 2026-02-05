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

export function switchAccountByIndex(openai: OpenAIMultiOauthAuth, index1: number): OpenAIMultiOauthAuth {
  const idx = Math.floor(index1 - 1)
  if (!Number.isFinite(idx) || idx < 0 || idx >= openai.accounts.length) throw new Error("Invalid account index")
  const target = openai.accounts[idx]
  if (!target?.identityKey) throw new Error("Target account missing identityKey")
  return { ...openai, activeIdentityKey: target.identityKey }
}
