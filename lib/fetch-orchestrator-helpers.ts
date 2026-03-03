import type { AuthData } from "./fetch-orchestrator-types.js"

const CROSS_ORIGIN_REDIRECT_STRIPPED_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "chatgpt-account-id",
  "session_id",
  "cookie",
  "set-cookie"
])

export const SESSION_KEY_TTL_MS = 6 * 60 * 60 * 1000
export const MAX_SESSION_KEYS = 200
export const DEFAULT_RATE_LIMIT_TOAST_DEBOUNCE_MS = 60_000
export const DEFAULT_SESSION_TOAST_DEBOUNCE_MS = 15_000
export const DEFAULT_ACCOUNT_SWITCH_TOAST_DEBOUNCE_MS = 15_000
export const MAX_TOAST_DEDUPE_KEYS = 512
export const TOAST_DEDUPE_TTL_MS = 6 * 60 * 60 * 1000

function normalizeSessionKey(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export async function resolveSessionKey(request: Request): Promise<string | null> {
  return normalizeSessionKey(request.headers.get("session_id"))
}

export function formatAccountLabel(auth: AuthData): string {
  const explicit = auth.accountLabel?.trim()
  if (explicit) return explicit

  const email = auth.email?.trim()
  const plan = auth.plan?.trim()
  const accountId = auth.accountId?.trim()
  const idSuffix = accountId ? (accountId.length > 6 ? accountId.slice(-6) : accountId) : undefined

  if (email && plan) return `${email} (${plan})`
  if (email) return email
  if (idSuffix) return `id:${idSuffix}`
  return "account"
}

export function resolveRetryAccountKey(auth: AuthData): string | null {
  const identityKey = auth.identityKey?.trim()
  if (identityKey) return `identity:${identityKey}`

  const attemptKey = auth.selectionTrace?.attemptKey?.trim()
  if (attemptKey) return `attempt:${attemptKey}`

  const accountId = auth.accountId?.trim()
  const email = auth.email?.trim()?.toLowerCase()
  const plan = auth.plan?.trim()?.toLowerCase()
  if (accountId && email && plan) {
    return `tuple:${accountId}|${email}|${plan}`
  }

  return null
}

export function stripCrossOriginRedirectHeaders(headers: Headers): void {
  for (const name of [...headers.keys()]) {
    if (CROSS_ORIGIN_REDIRECT_STRIPPED_HEADERS.has(name.trim().toLowerCase())) {
      headers.delete(name)
    }
  }
}
