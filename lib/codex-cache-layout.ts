import { createHash } from "node:crypto"
import path from "node:path"

import { defaultOpencodeCachePath } from "./paths.js"

export const CODEX_PROMPTS_CACHE_FILE = "codex-prompts-cache.json"
export const CODEX_PROMPTS_CACHE_META_FILE = "codex-prompts-cache-meta.json"

export const OPENCODE_MODELS_CACHE_PREFIX = "codex-models-cache"
export const CODEX_AUTH_MODELS_CACHE_PREFIX = "codex-auth-models-"
export const OPENCODE_MODELS_META_FILE = "codex-models-cache-meta.json"

export function resolveCodexCacheDir(cacheDir?: string): string {
  return cacheDir ?? defaultOpencodeCachePath()
}

function normalizeAccountId(accountId?: string): string | undefined {
  const next = accountId?.trim()
  return next ? next : undefined
}

function hashAccountId(accountId: string): string {
  return createHash("sha256").update(accountId).digest("hex").slice(0, 16)
}

export function buildCodexModelsMemoryCacheKey(cacheDir: string, accountId?: string): string {
  return `${cacheDir}::${normalizeAccountId(accountId) ?? "shared"}`
}

export function codexAuthModelsCachePath(cacheDir: string, accountId?: string): string {
  const normalized = normalizeAccountId(accountId)
  if (!normalized) {
    return path.join(cacheDir, "codex-auth-models-shared.json")
  }
  return path.join(cacheDir, `codex-auth-models-${hashAccountId(normalized)}.json`)
}

export function codexModelsCompatShardPath(cacheDir: string, accountId?: string): string | undefined {
  const normalized = normalizeAccountId(accountId)
  if (!normalized) return undefined
  return path.join(cacheDir, `codex-models-cache-${hashAccountId(normalized)}.json`)
}

export function codexModelsSharedCachePath(cacheDir: string): string {
  return path.join(cacheDir, "codex-models-cache.json")
}

export function codexModelsMetaPath(cacheDir: string): string {
  return path.join(cacheDir, OPENCODE_MODELS_META_FILE)
}

export function isCodexModelsCacheFileName(fileName: string): boolean {
  if (!fileName.endsWith(".json")) return false
  return fileName.startsWith(OPENCODE_MODELS_CACHE_PREFIX) || fileName.startsWith(CODEX_AUTH_MODELS_CACHE_PREFIX)
}

export function codexPromptsCachePath(cacheDir: string): string {
  return path.join(cacheDir, CODEX_PROMPTS_CACHE_FILE)
}

export function codexPromptsCacheMetaPath(cacheDir: string): string {
  return path.join(cacheDir, CODEX_PROMPTS_CACHE_META_FILE)
}
