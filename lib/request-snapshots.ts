import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import lockfile from "proper-lockfile"

import type { Logger } from "./logger"
import { defaultOpencodeConfigPath } from "./paths"

const DEFAULT_LOG_DIR = path.join(defaultOpencodeConfigPath(), "logs", "codex-plugin")
const REDACTED = "[redacted]"
const REDACTED_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "proxy-authorization",
  "chatgpt-account-id",
  "session_id"
])
const REDACTED_BODY_KEYS = new Set([
  "access_token",
  "refresh_token",
  "id_token",
  "authorization",
  "accesstoken",
  "refreshtoken",
  "idtoken"
])
const REDACTED_METADATA_KEYS = new Set(["sessionkey", "identitykey", "accountlabel", "accountid", "email", "plan"])
const LIVE_HEADERS_LOG_FILE = "live-headers.jsonl"
const PRIVATE_DIR_MODE = 0o700
const SNAPSHOT_LOCK_STALE_MS = 10_000
const SNAPSHOT_LOCK_RETRIES = {
  retries: 20,
  minTimeout: 10,
  maxTimeout: 100
}

async function ensurePrivateDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true, mode: PRIVATE_DIR_MODE })
  try {
    await fs.chmod(dirPath, PRIVATE_DIR_MODE)
  } catch {
    // best-effort permissions
  }
}

async function enforceOwnerOnlyPermissions(filePath: string): Promise<void> {
  try {
    await fs.chmod(filePath, 0o600)
  } catch {
    // best-effort permissions
  }
}

function sanitizeHeaderValue(name: string, value: string): string {
  const lower = name.toLowerCase()
  if (!REDACTED_HEADERS.has(lower)) return value
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

function sanitizeMetadata(meta: SnapshotMeta): Record<string, unknown> {
  if (!meta) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    out[key] = REDACTED_METADATA_KEYS.has(key.toLowerCase()) ? REDACTED : sanitizeBodyValue(value)
  }
  return out
}

function sanitizeUrlForSnapshot(url: string): string {
  try {
    const parsed = new URL(url)
    const base = `${parsed.origin}${parsed.pathname}`
    return parsed.search ? `${base}?[redacted]` : base
  } catch {
    const [base] = url.split("?", 1)
    return url.includes("?") ? `${base}?[redacted]` : base
  }
}

async function serializeRequestBody(request: Request): Promise<unknown> {
  try {
    const raw = await request.clone().text()
    if (!raw) return undefined

    const contentType = request.headers.get("content-type")?.toLowerCase() ?? ""
    try {
      return sanitizeBodyValue(JSON.parse(raw))
    } catch {
      if (contentType.includes("application/x-www-form-urlencoded")) {
        const params = new URLSearchParams(raw)
        const out: Record<string, unknown> = {}
        for (const [key, value] of params.entries()) {
          out[key] = REDACTED_BODY_KEYS.has(key.toLowerCase()) ? REDACTED : value
        }
        return out
      }
      if (contentType.startsWith("text/") || contentType.includes("application/xml") || contentType.includes("+xml")) {
        return raw.length > 8000 ? `${raw.slice(0, 8000)}... [truncated]` : raw
      }
      return "[non-json body omitted]"
    }
  } catch {
    return undefined
  }
}

type SnapshotWriterInput = {
  enabled: boolean
  dir?: string
  log?: Logger
  maxSnapshotFiles?: number
  maxLiveHeadersBytes?: number
}

type SnapshotMeta = Record<string, unknown> | undefined

function getPromptCacheKey(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined
  const candidate = (body as Record<string, unknown>).prompt_cache_key
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined
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

  const dir = input.dir ?? DEFAULT_LOG_DIR
  const maxSnapshotFiles =
    typeof input.maxSnapshotFiles === "number" && Number.isFinite(input.maxSnapshotFiles)
      ? Math.max(1, Math.floor(input.maxSnapshotFiles))
      : 200
  const maxLiveHeadersBytes =
    typeof input.maxLiveHeadersBytes === "number" && Number.isFinite(input.maxLiveHeadersBytes)
      ? Math.max(1, Math.floor(input.maxLiveHeadersBytes))
      : 1_000_000
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}-${randomUUID().slice(0, 8)}`
  let requestCounter = 0
  let responseCounter = 0

  const ensureDir = async (): Promise<void> => {
    await ensurePrivateDir(dir)
  }

  const withSnapshotLock = async <T>(fn: () => Promise<T>): Promise<T> => {
    await ensureDir()
    const lockTarget = path.join(dir, ".request-snapshots.lock")
    const release = await lockfile.lock(lockTarget, {
      realpath: false,
      stale: SNAPSHOT_LOCK_STALE_MS,
      retries: SNAPSHOT_LOCK_RETRIES
    })
    try {
      return await fn()
    } finally {
      await release()
    }
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
      await Promise.all(remove.map(({ filePath }) => fs.unlink(filePath).catch(() => {})))
    } catch {
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
          await fs.unlink(rotatedPath).catch(() => {})
          await fs.rename(filePath, rotatedPath)
          await enforceOwnerOnlyPermissions(rotatedPath)
        }
      } catch {
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
      const body = await serializeRequestBody(request)
      const headers = sanitizeHeaders(request.headers)
      const sanitizedMeta = sanitizeMetadata(meta)
      const payload = {
        timestamp,
        runId,
        requestId,
        stage,
        method: request.method,
        url: sanitizeUrlForSnapshot(request.url),
        headers,
        body,
        ...sanitizedMeta
      }
      await withSnapshotLock(async () => {
        await writeJson(`request-${requestId}-${stage}.json`, {
          ...payload
        })
        await appendJsonl(LIVE_HEADERS_LOG_FILE, {
          timestamp,
          runId,
          requestId,
          stage,
          method: request.method,
          url: sanitizeUrlForSnapshot(request.url),
          headers,
          prompt_cache_key: getPromptCacheKey(body),
          ...sanitizedMeta
        })
      })
    },
    captureResponse: async (stage, response, meta) => {
      const responseId = ++responseCounter
      const timestamp = new Date().toISOString()
      const sanitizedMeta = sanitizeMetadata(meta)
      await withSnapshotLock(async () => {
        await writeJson(`response-${responseId}-${stage}.json`, {
          timestamp,
          runId,
          responseId,
          stage,
          status: response.status,
          statusText: response.statusText,
          headers: sanitizeHeaders(response.headers),
          ...sanitizedMeta
        })
      })
    }
  }
}
