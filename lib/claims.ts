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
    return JSON.parse(Buffer.from(parts[1], "base64url").toString())
  } catch {
    return undefined
  }
}
