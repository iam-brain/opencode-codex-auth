import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fetchRemoteText } from "../remote-cache-fetch.js"
import { isFsErrorCode, readJsonFileBestEffort, writeJsonFileBestEffort } from "../cache-io.js"
import { withLockedDirectory } from "../cache-lock.js"
import {
  buildCodexModelsMemoryCacheKey,
  codexAuthModelsCachePath,
  codexModelsCompatShardPath,
  codexModelsMetaPath,
  codexModelsSharedCachePath,
  isCodexModelsCacheFileName
} from "../codex-cache-layout.js"
import {
  CACHE_TTL_MS,
  compareSemver,
  type CodexModelCatalogEvent,
  type CodexModelInfo,
  type CodexModelsCache,
  type GetCodexModelCatalogInput,
  FETCH_TIMEOUT_MS,
  githubModelsTag,
  githubModelsUrl,
  type GitHubModelsCacheMeta,
  isRecord,
  normalizeSemver,
  parseCatalogResponse,
  parseSemver,
  parseFetchedAtFromUnknown,
  semverFromTag
} from "./shared.js"

export function cacheKey(cacheDir: string, accountId?: string): string {
  return buildCodexModelsMemoryCacheKey(cacheDir, accountId)
}

export function cachePath(cacheDir: string, accountId?: string): string {
  return codexAuthModelsCachePath(cacheDir, accountId)
}

export function opencodeShardCachePath(cacheDir: string, accountId?: string): string | undefined {
  return codexModelsCompatShardPath(cacheDir, accountId)
}

function opencodeSharedCachePath(cacheDir: string): string {
  return codexModelsSharedCachePath(cacheDir)
}

async function readGitHubModelsCacheMeta(cacheDir: string): Promise<GitHubModelsCacheMeta | undefined> {
  const file = codexModelsMetaPath(cacheDir)
  const parsed = await readJsonFileBestEffort(file)
  if (!isRecord(parsed)) return undefined
  const parsedVersion = normalizeSemver(typeof parsed.version === "string" ? parsed.version : undefined)
  const parsedTag = typeof parsed.tag === "string" ? parsed.tag.trim() : ""
  const tag = parsedTag || (parsedVersion ? githubModelsTag(parsedVersion) : "")
  const url = typeof parsed.url === "string" ? parsed.url.trim() : ""
  const lastChecked =
    typeof parsed.lastChecked === "number" && Number.isFinite(parsed.lastChecked) ? parsed.lastChecked : 0
  const etag = typeof parsed.etag === "string" ? parsed.etag.trim() : undefined
  if (!tag || !url) return undefined
  return { etag, tag, url, lastChecked }
}

async function writeGitHubModelsCacheMeta(cacheDir: string, meta: GitHubModelsCacheMeta): Promise<void> {
  const file = codexModelsMetaPath(cacheDir)
  await writeJsonFileBestEffort(file, meta)
}

export async function refreshSharedGitHubModelsCache(input: {
  cacheDir: string
  targetClientVersion: string | undefined
  now: number
  fetchImpl: typeof fetch
}): Promise<void> {
  const targetVersion = normalizeSemver(input.targetClientVersion)
  if (!targetVersion) return

  const existingMeta = await readGitHubModelsCacheMeta(input.cacheDir)
  const existingVersion = parseSemver(semverFromTag(existingMeta?.tag))
  const target = parseSemver(targetVersion)
  if (!target) return
  if (existingVersion && compareSemver(existingVersion, target) >= 0) return

  const tag = githubModelsTag(targetVersion)
  const url = githubModelsUrl(targetVersion)
  const result = await fetchRemoteText(
    {
      key: "models",
      url,
      etag: existingMeta?.url === url ? existingMeta.etag : undefined
    },
    {
      fetchImpl: input.fetchImpl,
      timeoutMs: FETCH_TIMEOUT_MS,
      allowedHosts: ["raw.githubusercontent.com"]
    }
  )

  if (result.status === "not_modified" && existingMeta) {
    await writeGitHubModelsCacheMeta(input.cacheDir, {
      etag: existingMeta.etag,
      tag,
      lastChecked: input.now,
      url
    })
    return
  }

  if (result.status !== "ok") {
    return
  }

  try {
    const payload = JSON.parse(result.text) as unknown
    const models = parseCatalogResponse(payload)
    if (models.length === 0) return
    const etag = result.etag || (existingMeta?.url === url ? existingMeta.etag : undefined)

    const file = opencodeSharedCachePath(input.cacheDir)
    await writeJsonFileBestEffort(file, { fetchedAt: input.now, source: "github", models })

    await writeGitHubModelsCacheMeta(input.cacheDir, {
      etag,
      tag,
      lastChecked: input.now,
      url
    })
  } catch (_error) {
    // Best effort refresh; continue without blocking catalog load.
  }
}

export function isFresh(cache: CodexModelsCache, now: number): boolean {
  return now - cache.fetchedAt < CACHE_TTL_MS
}

async function withCacheLock<T>(cacheDir: string, fn: () => Promise<T>): Promise<T> {
  return withLockedDirectory(cacheDir, fn, { staleMs: 10_000 })
}

export async function readCatalogFromDisk(cacheDir: string, accountId?: string): Promise<CodexModelsCache | undefined> {
  return withCacheLock(cacheDir, async () => {
    const file = cachePath(cacheDir, accountId)
    const parsed = await readJsonFileBestEffort(file)
    if (!isRecord(parsed)) return undefined
    if (typeof parsed.fetchedAt !== "number") return undefined
    const models = parseCatalogResponse({ models: parsed.models })
    return {
      fetchedAt: parsed.fetchedAt,
      models
    }
  })
}

export async function readCatalogFromOpencodeCache(cacheDir: string): Promise<CodexModelsCache | undefined> {
  try {
    const entries = await fs.readdir(cacheDir)
    const candidates = entries.filter((name) => {
      return isCodexModelsCacheFileName(name)
    })
    if (candidates.length === 0) return undefined

    let best: CodexModelsCache | undefined
    for (const fileName of candidates) {
      const parsed = await readJsonFileBestEffort(path.join(cacheDir, fileName))
      if (!isRecord(parsed)) continue
      const models = parseCatalogResponse({ models: parsed.models })
      if (models.length === 0) continue
      const fetchedAt = typeof parsed.fetchedAt === "number" ? parsed.fetchedAt : 0
      if (!best || fetchedAt > best.fetchedAt) {
        best = {
          fetchedAt,
          models
        }
      }
    }

    return best
  } catch (error) {
    if (!isFsErrorCode(error, "ENOENT")) {
      // Best effort fallback discovery.
    }
    return undefined
  }
}

export async function readCatalogFromCodexCliCache(): Promise<CodexModelsCache | undefined> {
  const file = path.join(os.homedir(), ".codex", "models_cache.json")
  const parsed = await readJsonFileBestEffort(file)
  if (!isRecord(parsed)) return undefined
  const models = parseCatalogResponse({ models: parsed.models })
  if (models.length === 0) return undefined
  return {
    fetchedAt: parseFetchedAtFromUnknown(parsed.fetched_at ?? parsed.fetchedAt),
    models
  }
}

export async function writeCatalogToDisk(
  cacheDir: string,
  accountId: string | undefined,
  cache: CodexModelsCache
): Promise<void> {
  await withCacheLock(cacheDir, async () => {
    const primaryFile = cachePath(cacheDir, accountId)
    const compatFile = opencodeShardCachePath(cacheDir, accountId)
    const files = compatFile ? [primaryFile, compatFile] : [primaryFile]
    for (const file of files) {
      await writeJsonFileBestEffort(file, cache)
    }
  }).catch((error) => {
    if (error instanceof Error) {
      // Best effort cache persistence.
    }
    // Best effort cache persistence.
  })
}

export function emitEvent(input: GetCodexModelCatalogInput, event: Omit<CodexModelCatalogEvent, "scope">): void {
  try {
    input.onEvent?.({
      ...event,
      scope: input.accountId?.trim() ? "account" : "shared"
    })
  } catch (error) {
    if (error instanceof Error) {
      // Keep catalog path side-effect free even if observer callback throws.
    }
    // Keep catalog path side-effect free.
  }
}

export function deriveReason(value: unknown): string {
  if (value instanceof Error) {
    return value.name || "error"
  }
  return "error"
}

export function emitStaleCacheFallback(
  input: GetCodexModelCatalogInput,
  fallback: {
    disk?: CodexModelsCache
    opencode?: CodexModelsCache
    codexCli?: CodexModelsCache
  }
): CodexModelInfo[] | undefined {
  if (fallback.disk) {
    emitEvent(input, { type: "stale_cache_used", reason: "network_fetch_failed" })
    return fallback.disk.models
  }
  if (fallback.opencode) {
    emitEvent(input, { type: "stale_cache_used", reason: "opencode_cache_fallback" })
    return fallback.opencode.models
  }
  if (fallback.codexCli) {
    emitEvent(input, { type: "stale_cache_used", reason: "codex_cli_cache_fallback" })
    return fallback.codexCli.models
  }
  return undefined
}
