import {
  cacheKey,
  deriveReason,
  emitEvent,
  emitStaleCacheFallback,
  isFresh,
  readCatalogFromDisk,
  readCatalogFromGitHubCache,
  refreshSharedGitHubModelsCache,
  writeCatalogToDisk
} from "./cache-helpers.js"
import {
  type CodexModelInfo,
  CODEX_MODELS_ENDPOINT,
  DEFAULT_CLIENT_VERSION,
  FETCH_TIMEOUT_MS,
  type GetCodexModelCatalogInput,
  parseCatalogResponse,
  normalizeSemver
} from "./shared.js"
import { resolveCodexCacheDir } from "../codex-cache-layout.js"

const inMemoryCatalog = new Map<string, { fetchedAt: number; models: CodexModelInfo[]; staleFallback?: boolean }>()
const inFlightCatalogFetches = new Map<string, Promise<CodexModelInfo[] | undefined>>()

function normalizeClientVersion(value: string | undefined, fallback?: string): string {
  const trimmed = value?.trim()
  if (trimmed) return trimmed
  const fallbackTrimmed = fallback?.trim()
  return fallbackTrimmed || DEFAULT_CLIENT_VERSION
}

function buildModelsEndpoint(clientVersion: string): string {
  const separator = CODEX_MODELS_ENDPOINT.includes("?") ? "&" : "?"
  return `${CODEX_MODELS_ENDPOINT}${separator}client_version=${encodeURIComponent(clientVersion)}`
}

export async function getCodexModelCatalog(input: GetCodexModelCatalogInput): Promise<CodexModelInfo[] | undefined> {
  const now = (input.now ?? Date.now)()
  const cacheDir = resolveCodexCacheDir(input.cacheDir)
  const key = cacheKey(cacheDir, input.accountId)
  const fetchImpl = input.fetchImpl ?? fetch
  const accessToken = input.accessToken?.trim()
  const targetClientVersion = normalizeSemver(input.clientVersion) ?? normalizeSemver(input.versionHeader)
  const githubFallbackVersion =
    normalizeSemver(normalizeClientVersion(input.clientVersion, input.versionHeader)) ??
    normalizeSemver(DEFAULT_CLIENT_VERSION) ??
    DEFAULT_CLIENT_VERSION
  const defaultGithubModelsRefresh =
    Boolean(accessToken) && input.fetchImpl === undefined && targetClientVersion !== undefined
  const shouldRefreshGithubModelsCache = input.refreshGithubModelsCache ?? defaultGithubModelsRefresh

  if (shouldRefreshGithubModelsCache) {
    await refreshSharedGitHubModelsCache({
      cacheDir,
      targetClientVersion,
      now,
      fetchImpl
    })
  }

  const memory = inMemoryCatalog.get(key)
  const allowMemoryHit = !memory?.staleFallback || !accessToken
  if (memory && !input.forceRefresh && isFresh(memory, now) && allowMemoryHit) {
    emitEvent(input, { type: "memory_cache_hit" })
    return memory.models
  }

  const disk = await readCatalogFromDisk(cacheDir, input.accountId)
  const hasFreshDisk = !!disk && isFresh(disk, now)
  if (hasFreshDisk && !input.forceRefresh) {
    inMemoryCatalog.set(key, disk)
    emitEvent(input, { type: "disk_cache_hit" })
    return disk.models
  }

  let githubCacheFallback: { fetchedAt: number; models: CodexModelInfo[] } | undefined

  const ensureFallbackCaches = async (refreshGithub = false): Promise<void> => {
    if (!githubCacheFallback) {
      githubCacheFallback = await readCatalogFromGitHubCache(cacheDir)
    }
    if (refreshGithub) {
      await refreshSharedGitHubModelsCache({
        cacheDir,
        targetClientVersion: githubFallbackVersion,
        now,
        fetchImpl
      })
      githubCacheFallback = (await readCatalogFromGitHubCache(cacheDir)) ?? githubCacheFallback
    }
  }

  if (!accessToken) {
    await ensureFallbackCaches()
    if (!githubCacheFallback) {
      await ensureFallbackCaches(true)
    }
    if (disk) {
      emitEvent(input, { type: "stale_cache_used", reason: "missing_access_token" })
      inMemoryCatalog.set(key, disk)
      return disk.models
    }
    const stale = emitStaleCacheFallback(input, {
      github: githubCacheFallback
    })
    if (stale) {
      inMemoryCatalog.set(key, {
        fetchedAt: now,
        models: stale,
        staleFallback: true
      })
      return stale
    }
    emitEvent(input, { type: "catalog_unavailable", reason: "missing_access_token" })
    return undefined
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${accessToken}`,
    originator: input.originator?.trim() || "opencode"
  }
  const clientVersion = normalizeClientVersion(input.clientVersion, input.versionHeader)
  const versionHeader = normalizeClientVersion(input.versionHeader, input.clientVersion)
  if (versionHeader) headers.version = versionHeader
  const userAgent = input.userAgent?.trim()
  if (userAgent) headers["user-agent"] = userAgent
  const betaValue = input.openaiBeta?.trim()
  if (betaValue) headers["openai-beta"] = betaValue
  const accountId = input.accountId?.trim() || undefined
  if (accountId) {
    headers["chatgpt-account-id"] = accountId
  }

  const existingInFlight = inFlightCatalogFetches.get(key)
  if (existingInFlight) {
    return existingInFlight
  }

  const inFlight = (async (): Promise<CodexModelInfo[] | undefined> => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
      let response: Response
      try {
        const endpoint = buildModelsEndpoint(clientVersion)
        response = await fetchImpl(endpoint, {
          method: "GET",
          headers,
          signal: controller.signal
        })
      } finally {
        clearTimeout(timeout)
      }

      if (!response.ok) {
        throw new Error(`codex models request failed with status ${response.status}`)
      }

      const payload = await response.json()
      const models = parseCatalogResponse(payload)
      if (models.length === 0) {
        throw new Error("codex models response did not contain usable models")
      }
      await ensureFallbackCaches(true)

      const nextCache = {
        fetchedAt: now,
        models
      }
      inMemoryCatalog.set(key, nextCache)
      await writeCatalogToDisk(cacheDir, accountId, nextCache)
      emitEvent(input, { type: "network_fetch_success" })
      return nextCache.models
    } catch (error) {
      emitEvent(input, { type: "network_fetch_failed", reason: deriveReason(error) })
      await ensureFallbackCaches()
      if (!githubCacheFallback) {
        await ensureFallbackCaches(true)
      }
      const stale = emitStaleCacheFallback(input, {
        disk,
        github: githubCacheFallback
      })
      if (stale) {
        inMemoryCatalog.set(key, {
          fetchedAt: now,
          models: stale,
          staleFallback: true
        })
        return stale
      }
      emitEvent(input, { type: "catalog_unavailable", reason: "network_fetch_failed" })
      return undefined
    }
  })()

  inFlightCatalogFetches.set(key, inFlight)
  return inFlight.finally(() => {
    if (inFlightCatalogFetches.get(key) === inFlight) {
      inFlightCatalogFetches.delete(key)
    }
  })
}
