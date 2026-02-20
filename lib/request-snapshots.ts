import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

import type { Logger } from "./logger"
import { enforceOwnerOnlyPermissions, isFsErrorCode } from "./cache-io"
import { defaultCodexPluginLogsPath } from "./paths"
const REDACTED = "[redacted]"
const REDACTED_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-proto",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-api-key",
  "api-key",
  "x-openai-api-key",
  "openai-api-key",
  "x-anthropic-api-key",
  "x-real-ip",
  "true-client-ip",
  "cf-connecting-ip",
  "x-client-ip",
  "chatgpt-account-id",
  "session_id"
])
const REDACTED_BODY_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "authorization",
  "prompt_cache_key",
  "authorization_code",
  "auth_code",
  "code_verifier",
  "pkce_verifier",
  "verifier",
  "state",
  "code",
  "api_key",
  "apikey",
  "client_secret",
  "clientsecret",
  "authorizationcode",
  "codeverifier",
  "accesstoken",
  "refreshtoken",
  "idtoken"
])
const LIVE_HEADERS_LOG_FILE = "live-headers.jsonl"

function sanitizeHeaderValue(name: string, value: string): string {
  const lower = name.toLowerCase()
  if (!REDACTED_HEADERS.has(lower) && !lower.includes("api-key")) return value
  if (lower === "authorization") {
    const [scheme] = value.split(" ")
    return scheme ? `${scheme} ${REDACTED}` : REDACTED
  }
  return REDACTED
}

function sanitizeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of headers.entries()) {
    out[name.toLowerCase()] = sanitizeHeaderValue(name, value)
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

function sanitizeBodyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sanitizeBodyValue(entry))
  if (!value || typeof value !== "object") return value

  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    out[key] = REDACTED_BODY_KEYS.has(key.toLowerCase()) ? REDACTED : sanitizeBodyValue(entry)
  }
  return out
}

function redactRawBody(raw: string): string {
  return raw
    .replace(
      /([?&;\s]|^)(access_token|refresh_token|id_token|prompt_cache_key|authorization_code|auth_code|code_verifier|pkce_verifier|verifier|state|code|api_key|apikey|client_secret|clientsecret|authorizationCode|authorizationcode|codeVerifier|codeverifier|apiKey|clientSecret|accessToken|refreshToken|idToken)=([^&;\s]+)/gi,
      (_full, prefix: string, key: string) => `${prefix}${key}=${REDACTED}`
    )
    .replace(
      /"(access_token|refresh_token|id_token|prompt_cache_key|authorization_code|auth_code|code_verifier|pkce_verifier|verifier|state|code|api_key|apikey|client_secret|clientsecret|authorizationCode|authorizationcode|codeVerifier|codeverifier|apiKey|clientSecret|accessToken|refreshToken|idToken)"\s*:\s*"[^"]*"/gi,
      (_full, key: string) => `"${key}":"${REDACTED}"`
    )
}

function sanitizeMetaString(value: string): string {
  return value
    .replace(
      /([?&;\s]|^)(access_token|refresh_token|id_token|prompt_cache_key|authorization_code|auth_code|code_verifier|pkce_verifier|verifier|state|code|api_key|apikey|client_secret|clientsecret|authorizationCode|authorizationcode|codeVerifier|codeverifier|apiKey|clientSecret|accessToken|refreshToken|idToken)=([^&;\s]+)/gi,
      (_full, prefix: string, key: string) => `${prefix}${key}=${REDACTED}`
    )
    .replace(
      /"(access_token|refresh_token|id_token|prompt_cache_key|authorization_code|auth_code|code_verifier|pkce_verifier|verifier|state|code|api_key|apikey|client_secret|clientsecret|authorizationCode|authorizationcode|codeVerifier|codeverifier|apiKey|clientSecret|accessToken|refreshToken|idToken)"\s*:\s*"[^"]*"/gi,
      (_full, key: string) => `"${key}":"${REDACTED}"`
    )
    .replace(/\b(authorization)\s*:\s*bearer\s+[^\s,;]+/gi, `$1: Bearer ${REDACTED}`)
}

async function serializeRequestBody(request: Request): Promise<unknown> {
  try {
    const raw = await request.clone().text()
    if (!raw) return undefined
    try {
      return sanitizeBodyValue(JSON.parse(raw))
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        // treat as raw body on unexpected parse failures
      }
      const redactedRaw = redactRawBody(raw)
      return redactedRaw.length > 8000 ? `${redactedRaw.slice(0, 8000)}... [truncated]` : redactedRaw
    }
  } catch (error) {
    if (!(error instanceof Error && error.name === "AbortError")) {
      // best-effort request body extraction
    }
    return undefined
  }
}

type SnapshotWriterInput = {
  enabled: boolean
  dir?: string
  log?: Logger
  maxSnapshotFiles?: number
  maxLiveHeadersBytes?: number
  captureBodies?: boolean
}

type SnapshotMeta = Record<string, unknown> | undefined

const REDACTED_META_KEYS = new Set([
  "identitykey",
  "accountlabel",
  "sessionkey",
  "selectionselectedidentitykey",
  "selectionactiveidentitykey",
  "selectionsessionkey",
  "selectionattemptkey"
])

const REDACTED_META_KEY_FRAGMENTS = [
  "token",
  "secret",
  "password",
  "authorization",
  "cookie",
  "session",
  "identitykey",
  "accountlabel"
]

function shouldRedactMetaKey(key: string): boolean {
  const lower = key.trim().toLowerCase()
  if (!lower) return false
  if (REDACTED_META_KEYS.has(lower)) return true
  return REDACTED_META_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment))
}

function sanitizeMetaValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sanitizeMetaValue(entry))
  if (typeof value === "string") return sanitizeMetaString(value)
  if (!value || typeof value !== "object") return value
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = shouldRedactMetaKey(key) ? REDACTED : sanitizeMetaValue(entry)
  }
  return out
}

const REDACTED_QUERY_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "prompt_cache_key",
  "authorization_code",
  "auth_code",
  "code_verifier",
  "pkce_verifier",
  "verifier",
  "state",
  "code",
  "api_key",
  "apikey",
  "client_secret",
  "clientsecret",
  "authorizationcode",
  "codeverifier",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "session_id",
  "chatgpt-account-id",
  "chatgpt_account_id"
])

const REDACTED_QUERY_KEY_FRAGMENTS = ["token", "secret", "session", "verifier", "pkce", "authorization_code"]

function shouldRedactQueryKey(key: string): boolean {
  const lower = key.toLowerCase()
  if (REDACTED_QUERY_KEYS.has(lower)) return true
  return REDACTED_QUERY_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment))
}

function getPromptCacheKey(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined
  const candidate = (body as Record<string, unknown>).prompt_cache_key
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined
}

function sanitizePromptCacheKey(value: string | undefined): string | undefined {
  if (!value) return undefined
  return REDACTED
}

const RESERVED_SNAPSHOT_META_KEYS = new Set([
  "timestamp",
  "runid",
  "requestid",
  "responseid",
  "stage",
  "method",
  "url",
  "headers",
  "body",
  "status",
  "statustext",
  "prompt_cache_key"
])

function sanitizeSnapshotMeta(meta: SnapshotMeta): Record<string, unknown> {
  if (!meta) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    if (RESERVED_SNAPSHOT_META_KEYS.has(key.trim().toLowerCase())) continue
    out[key] = shouldRedactMetaKey(key) ? REDACTED : sanitizeMetaValue(value)
  }
  return out
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value)
    for (const [key] of url.searchParams.entries()) {
      if (!shouldRedactQueryKey(key)) continue
      url.searchParams.set(key, REDACTED)
    }
    return url.toString()
  } catch (_error) {
    return value
  }
}

export type RequestSnapshots = {
  captureRequest: (stage: string, request: Request, meta?: SnapshotMeta) => Promise<void>
  captureResponse: (stage: string, response: Response, meta?: SnapshotMeta) => Promise<void>
}

export function createRequestSnapshots(input: SnapshotWriterInput): RequestSnapshots {
  if (!input.enabled) {
    return {
      captureRequest: async () => {},
      captureResponse: async () => {}
    }
  }

  const dir = input.dir ?? defaultCodexPluginLogsPath()
  const maxSnapshotFiles =
    typeof input.maxSnapshotFiles === "number" && Number.isFinite(input.maxSnapshotFiles)
      ? Math.max(1, Math.floor(input.maxSnapshotFiles))
      : 200
  const maxLiveHeadersBytes =
    typeof input.maxLiveHeadersBytes === "number" && Number.isFinite(input.maxLiveHeadersBytes)
      ? Math.max(1, Math.floor(input.maxLiveHeadersBytes))
      : 1_000_000
  const captureBodies = input.captureBodies === true
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${randomUUID().slice(0, 8)}`
  let requestCounter = 0
  let responseCounter = 0

  const ensureDir = async (): Promise<void> => {
    await fs.mkdir(dir, { recursive: true })
    await fs.chmod(dir, 0o700).catch((error) => {
      if (!isFsErrorCode(error, "EACCES") && !isFsErrorCode(error, "EPERM")) {
        throw error
      }
    })
  }

  const pruneSnapshotFiles = async (): Promise<void> => {
    try {
      const entries = await fs.readdir(dir)
      const snapshots = entries
        .filter((name) => name.includes("-request-") || name.includes("-response-"))
        .map((name) => path.join(dir, name))

      if (snapshots.length <= maxSnapshotFiles) return

      const withMtime = await Promise.all(
        snapshots.map(async (filePath) => {
          const stat = await fs.stat(filePath)
          return { filePath, mtimeMs: stat.mtimeMs }
        })
      )

      withMtime.sort((left, right) => left.mtimeMs - right.mtimeMs)
      const remove = withMtime.slice(0, withMtime.length - maxSnapshotFiles)
      await Promise.all(
        remove.map(async ({ filePath }) => {
          try {
            await fs.unlink(filePath)
          } catch (error) {
            if (!isFsErrorCode(error, "ENOENT")) {
              // best-effort prune
            }
          }
        })
      )
    } catch (error) {
      if (!isFsErrorCode(error, "ENOENT")) {
        // best-effort cleanup
      }
      // best-effort cleanup
    }
  }

  const writeJson = async (fileName: string, payload: Record<string, unknown>): Promise<void> => {
    try {
      await ensureDir()
      const filePath = path.join(dir, `${runId}-${fileName}`)
      await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
      await enforceOwnerOnlyPermissions(filePath)
      await pruneSnapshotFiles()
    } catch (error) {
      input.log?.warn("failed to write request snapshot", {
        fileName,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const appendJsonl = async (fileName: string, payload: Record<string, unknown>): Promise<void> => {
    try {
      await ensureDir()
      const filePath = path.join(dir, fileName)
      const rotatedPath = `${filePath}.1`
      try {
        const stat = await fs.stat(filePath)
        if (stat.size >= maxLiveHeadersBytes) {
          try {
            await fs.unlink(rotatedPath)
          } catch (error) {
            if (!isFsErrorCode(error, "ENOENT")) {
              // ignore non-fatal rotate cleanup errors
            }
          }
          await fs.rename(filePath, rotatedPath)
          await enforceOwnerOnlyPermissions(rotatedPath)
        }
      } catch (error) {
        if (!isFsErrorCode(error, "ENOENT")) {
          // ignore when file does not exist or cannot be stat'ed
        }
        // ignore when file does not exist or cannot be stat'ed
      }
      await fs.appendFile(filePath, `${JSON.stringify(payload)}\n`, { mode: 0o600 })
      await enforceOwnerOnlyPermissions(filePath)
    } catch (error) {
      input.log?.warn("failed to append request snapshot line", {
        fileName,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return {
    captureRequest: async (stage, request, meta) => {
      const requestId = ++requestCounter
      const timestamp = new Date().toISOString()
      const body = captureBodies ? await serializeRequestBody(request) : undefined
      const headers = sanitizeHeaders(request.headers)
      const sanitizedMeta = sanitizeSnapshotMeta(meta)
      const sanitizedUrl = sanitizeUrl(request.url)
      const payload = {
        timestamp,
        runId,
        requestId,
        stage,
        method: request.method,
        url: sanitizedUrl,
        headers,
        body,
        meta: sanitizedMeta
      }
      await writeJson(`request-${requestId}-${stage}.json`, {
        ...payload
      })
      await appendJsonl(LIVE_HEADERS_LOG_FILE, {
        timestamp,
        runId,
        requestId,
        stage,
        method: request.method,
        url: sanitizedUrl,
        headers,
        prompt_cache_key: sanitizePromptCacheKey(getPromptCacheKey(body)),
        meta: sanitizedMeta
      })
    },
    captureResponse: async (stage, response, meta) => {
      const responseId = ++responseCounter
      const timestamp = new Date().toISOString()
      const sanitizedMeta = sanitizeSnapshotMeta(meta)
      await writeJson(`response-${responseId}-${stage}.json`, {
        timestamp,
        runId,
        responseId,
        stage,
        status: response.status,
        statusText: response.statusText,
        headers: sanitizeHeaders(response.headers),
        meta: sanitizedMeta
      })
    }
  }
}
