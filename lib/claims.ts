export interface IdTokenClaims {
  chatgpt_account_id?: string
  email?: string
  plan?: string
  organizations?: Array<{ id: string }>
  "https://api.openai.com/auth"?: { chatgpt_account_id?: string }
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
