import { fetchRemoteTextBatch, type RemoteTextFetchResult } from "./remote-cache-fetch"
import { readJsonFileBestEffort, writeJsonFileBestEffort } from "./cache-io"
import {
  CODEX_PROMPTS_CACHE_FILE,
  CODEX_PROMPTS_CACHE_META_FILE,
  codexPromptsCacheMetaPath,
  codexPromptsCachePath,
  resolveCodexCacheDir
} from "./codex-cache-layout"

export { CODEX_PROMPTS_CACHE_FILE, CODEX_PROMPTS_CACHE_META_FILE } from "./codex-cache-layout"

export const CODEX_ORCHESTRATOR_PROMPT_URL =
  "https://raw.githubusercontent.com/openai/codex/4ab44e2c5cc54ed47e47a6729dfd8aa5a3dc2476/codex-rs/core/templates/agents/orchestrator.md"
export const CODEX_PLAN_PROMPT_URL =
  "https://raw.githubusercontent.com/openai/codex/4ab44e2c5cc54ed47e47a6729dfd8aa5a3dc2476/codex-rs/core/templates/collaboration_mode/plan.md"

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 5000

type CodexPromptsCache = {
  fetchedAt: number
  source: "github"
  prompts: {
    orchestrator: string
    plan: string
  }
}

type CodexPromptsCacheMeta = {
  lastChecked: number
  urls: {
    orchestrator: string
    plan: string
  }
  etags?: {
    orchestrator?: string
    plan?: string
  }
}

type RefreshResult = {
  orchestrator?: string
  plan?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizePrompt(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

async function readPromptsCache(cacheDir: string): Promise<CodexPromptsCache | undefined> {
  const parsed = await readJsonFileBestEffort(codexPromptsCachePath(cacheDir))
  if (!isRecord(parsed)) return undefined
  const prompts = isRecord(parsed.prompts) ? parsed.prompts : undefined
  const orchestrator = normalizePrompt(prompts?.orchestrator)
  const plan = normalizePrompt(prompts?.plan)
  if (!orchestrator || !plan) return undefined
  const fetchedAt = typeof parsed.fetchedAt === "number" && Number.isFinite(parsed.fetchedAt) ? parsed.fetchedAt : 0
  return {
    fetchedAt,
    source: "github",
    prompts: {
      orchestrator,
      plan
    }
  }
}

async function writePromptsCache(cacheDir: string, cache: CodexPromptsCache): Promise<void> {
  await writeJsonFileBestEffort(codexPromptsCachePath(cacheDir), cache)
}

async function readPromptsCacheMeta(cacheDir: string): Promise<CodexPromptsCacheMeta | undefined> {
  const parsed = await readJsonFileBestEffort(codexPromptsCacheMetaPath(cacheDir))
  if (!isRecord(parsed)) return undefined
  const urls = isRecord(parsed.urls) ? parsed.urls : undefined
  const orchestrator = normalizePrompt(urls?.orchestrator)
  const plan = normalizePrompt(urls?.plan)
  if (!orchestrator || !plan) return undefined
  const lastChecked =
    typeof parsed.lastChecked === "number" && Number.isFinite(parsed.lastChecked) ? parsed.lastChecked : 0
  const etagsRecord = isRecord(parsed.etags) ? parsed.etags : undefined
  const etags = etagsRecord
    ? {
        orchestrator: normalizePrompt(etagsRecord.orchestrator),
        plan: normalizePrompt(etagsRecord.plan)
      }
    : undefined
  return {
    lastChecked,
    urls: { orchestrator, plan },
    etags
  }
}

async function writePromptsCacheMeta(cacheDir: string, meta: CodexPromptsCacheMeta): Promise<void> {
  await writeJsonFileBestEffort(codexPromptsCacheMetaPath(cacheDir), meta)
}

function resolvePrompt(result: RemoteTextFetchResult | undefined, existing: string | undefined): string | undefined {
  if (!result) return undefined
  if (result.status === "ok") {
    return normalizePrompt(result.text)
  }
  if (result.status === "not_modified") {
    return existing
  }
  return undefined
}

function resolveEtag(result: RemoteTextFetchResult | undefined, existing: string | undefined): string | undefined {
  if (!result) return existing
  if (result.status === "ok") return result.etag ?? existing
  if (result.status === "not_modified") return result.etag ?? existing
  return existing
}

export async function readCachedCodexPrompts(
  input: {
    cacheDir?: string
  } = {}
): Promise<RefreshResult> {
  const cacheDir = resolveCodexCacheDir(input.cacheDir)
  const cache = await readPromptsCache(cacheDir)
  if (!cache) return {}
  return {
    orchestrator: cache.prompts.orchestrator,
    plan: cache.prompts.plan
  }
}

export async function refreshCachedCodexPrompts(
  input: {
    cacheDir?: string
    now?: () => number
    fetchImpl?: typeof fetch
    forceRefresh?: boolean
  } = {}
): Promise<RefreshResult> {
  const cacheDir = resolveCodexCacheDir(input.cacheDir)
  const now = (input.now ?? Date.now)()
  const fetchImpl = input.fetchImpl ?? fetch

  const existingCache = await readPromptsCache(cacheDir)
  const existingMeta = await readPromptsCacheMeta(cacheDir)

  const cacheIsFresh =
    existingCache &&
    existingMeta &&
    existingMeta.urls.orchestrator === CODEX_ORCHESTRATOR_PROMPT_URL &&
    existingMeta.urls.plan === CODEX_PLAN_PROMPT_URL &&
    now - existingMeta.lastChecked < CACHE_TTL_MS

  if (cacheIsFresh && input.forceRefresh !== true) {
    return {
      orchestrator: existingCache.prompts.orchestrator,
      plan: existingCache.prompts.plan
    }
  }

  const results = await fetchRemoteTextBatch(
    {
      requests: [
        {
          key: "orchestrator",
          url: CODEX_ORCHESTRATOR_PROMPT_URL,
          etag:
            existingMeta?.urls.orchestrator === CODEX_ORCHESTRATOR_PROMPT_URL
              ? existingMeta?.etags?.orchestrator
              : undefined
        },
        {
          key: "plan",
          url: CODEX_PLAN_PROMPT_URL,
          etag: existingMeta?.urls.plan === CODEX_PLAN_PROMPT_URL ? existingMeta?.etags?.plan : undefined
        }
      ]
    },
    {
      fetchImpl,
      timeoutMs: FETCH_TIMEOUT_MS
    }
  )
  const orchestratorResult = results.find((result) => result.key === "orchestrator")
  const planResult = results.find((result) => result.key === "plan")

  const orchestrator = resolvePrompt(orchestratorResult, existingCache?.prompts.orchestrator)
  const plan = resolvePrompt(planResult, existingCache?.prompts.plan)

  if (!orchestrator || !plan) {
    return {
      orchestrator: existingCache?.prompts.orchestrator,
      plan: existingCache?.prompts.plan
    }
  }

  const nextCache: CodexPromptsCache = {
    fetchedAt: now,
    source: "github",
    prompts: {
      orchestrator,
      plan
    }
  }
  await writePromptsCache(cacheDir, nextCache)
  await writePromptsCacheMeta(cacheDir, {
    lastChecked: now,
    urls: {
      orchestrator: CODEX_ORCHESTRATOR_PROMPT_URL,
      plan: CODEX_PLAN_PROMPT_URL
    },
    etags: {
      orchestrator: resolveEtag(orchestratorResult, existingMeta?.etags?.orchestrator),
      plan: resolveEtag(planResult, existingMeta?.etags?.plan)
    }
  })

  return {
    orchestrator,
    plan
  }
}
