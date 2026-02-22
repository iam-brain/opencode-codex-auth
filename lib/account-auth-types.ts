import type { AccountAuthType } from "./types.js"

const ACCOUNT_AUTH_TYPE_ORDER: AccountAuthType[] = ["native", "codex"]

export function normalizeAccountAuthTypes(input: unknown): AccountAuthType[] {
  const source = Array.isArray(input) ? input : ["native"]
  const seen = new Set<AccountAuthType>()
  const out: AccountAuthType[] = []

  for (const rawType of source) {
    const type = rawType === "codex" ? "codex" : rawType === "native" ? "native" : undefined
    if (!type || seen.has(type)) continue
    seen.add(type)
    out.push(type)
  }

  if (out.length === 0) out.push("native")
  out.sort((a, b) => ACCOUNT_AUTH_TYPE_ORDER.indexOf(a) - ACCOUNT_AUTH_TYPE_ORDER.indexOf(b))
  return out
}
