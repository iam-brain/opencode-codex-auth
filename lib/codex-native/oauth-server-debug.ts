import { appendFileSync, chmodSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs"

import { isFsErrorCode } from "../cache-io.js"

const DEFAULT_DEBUG_LOG_MAX_BYTES = 1_000_000
const REDACTED = "[redacted]"
const REDACTED_DEBUG_META_KEY_FRAGMENTS = [
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
  "id_token",
  "refresh_token",
  "access_token",
  "authorization_code",
  "auth_code",
  "code_verifier",
  "pkce",
  "verifier"
]

function shouldRedactDebugMetaKey(key: string): boolean {
  const lower = key.trim().toLowerCase()
  if (!lower) return false
  return REDACTED_DEBUG_META_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment))
}

export function sanitizeDebugMeta(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(
        /\b(access_token|refresh_token|id_token|authorization_code|auth_code|code_verifier|pkce_verifier)=([^\s&]+)/gi,
        `$1=${REDACTED}`
      )
      .replace(
        /"(access_token|refresh_token|id_token|authorization_code|auth_code|code_verifier|pkce_verifier)"\s*:\s*"[^"]*"/gi,
        `"$1":"${REDACTED}"`
      )
      .replace(
        /([?&])(code|state|access_token|refresh_token|id_token|code_verifier|pkce_verifier)=([^&]+)/gi,
        (_match, prefix, key) => {
          return `${prefix}${key}=${REDACTED}`
        }
      )
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeDebugMeta(item))
  if (!value || typeof value !== "object") return value

  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = shouldRedactDebugMetaKey(key) ? REDACTED : sanitizeDebugMeta(entry)
  }
  return out
}

export function resolveDebugLogMaxBytes(): number {
  const raw = process.env.CODEX_AUTH_DEBUG_MAX_BYTES
  if (!raw) return DEFAULT_DEBUG_LOG_MAX_BYTES
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return DEFAULT_DEBUG_LOG_MAX_BYTES
  return Math.max(16_384, Math.floor(parsed))
}

export function rotateDebugLogIfNeeded(debugLogFile: string, maxBytes: number): void {
  try {
    const stat = statSync(debugLogFile)
    if (stat.size < maxBytes) return
    const rotatedPath = `${debugLogFile}.1`
    try {
      unlinkSync(rotatedPath)
    } catch (error) {
      if (!isFsErrorCode(error, "ENOENT")) {
        // ignore missing previous rotation file
      }
      // ignore missing previous rotation file
    }
    renameSync(debugLogFile, rotatedPath)
  } catch (error) {
    if (!isFsErrorCode(error, "ENOENT")) {
      // ignore when file does not exist or cannot be inspected
    }
    // ignore when file does not exist or cannot be inspected
  }
}

export function appendDebugLine(input: {
  debugLogDir: string
  debugLogFile: string
  debugLogMaxBytes: number
  line: string
}): void {
  try {
    mkdirSync(input.debugLogDir, { recursive: true, mode: 0o700 })
    rotateDebugLogIfNeeded(input.debugLogFile, input.debugLogMaxBytes)
    appendFileSync(input.debugLogFile, `${input.line}\n`, { encoding: "utf8", mode: 0o600 })
    chmodSync(input.debugLogFile, 0o600)
  } catch (error) {
    if (error instanceof Error) {
      // best effort file logging
    }
    // best effort file logging
  }
}
