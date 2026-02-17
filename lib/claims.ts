export interface IdTokenClaims {
  chatgpt_account_id?: string
  email?: string
  plan?: string
  organizations?: Array<{ id: string }>
  "https://api.openai.com/auth"?: { chatgpt_account_id?: string; chatgpt_plan_type?: string }
  "https://api.openai.com/profile"?: { email?: string }
}

export function parseJwtClaims(token: string): IdTokenClaims | undefined {
  const parts = token.split(".")
  if (parts.length !== 3) return undefined

  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString())
    if (typeof parsed !== "object" || parsed === null) return undefined
    if (Array.isArray(parsed)) return undefined

    const proto = Object.getPrototypeOf(parsed)
    if (proto !== Object.prototype && proto !== null) return undefined

    return parsed as IdTokenClaims
  } catch {
    return undefined
  }
}

export function extractAccountIdFromClaims(claims: IdTokenClaims | undefined): string | undefined {
  if (!claims) return undefined
  return (
    claims.chatgpt_account_id ||
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  )
}

export function extractEmailFromClaims(claims: IdTokenClaims | undefined): string | undefined {
  if (!claims) return undefined
  return claims.email || claims["https://api.openai.com/profile"]?.email
}

export function extractPlanFromClaims(claims: IdTokenClaims | undefined): string | undefined {
  if (!claims) return undefined
  return claims.plan || claims["https://api.openai.com/auth"]?.chatgpt_plan_type
}
