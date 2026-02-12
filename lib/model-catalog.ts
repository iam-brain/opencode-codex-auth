import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import lockfile from "proper-lockfile"
import { resolveCustomPersonalityDescription } from "./personalities"

export type PersonalityOption = string

type ModelInstructionsVariables = {
  personality?: string | null
  personality_default?: string | null
  personality_friendly?: string | null
  personality_pragmatic?: string | null
  personalities?: Record<string, string | null> | null
}

type ModelMessages = {
  instructions_template?: string | null
  instructions_variables?: ModelInstructionsVariables | null
}

type ModelReasoningLevel = {
  effort?: string | null
}

export type CodexModelInfo = {
  slug: string
  model_messages?: ModelMessages | null
  base_instructions?: string | null
  apply_patch_tool_type?: string | null
  supported_reasoning_levels?: ModelReasoningLevel[] | null
  default_reasoning_level?: string | null
  supports_reasoning_summaries?: boolean | null
  reasoning_summary_format?: string | null
  support_verbosity?: boolean | null
  default_verbosity?: string | null
}

type CodexModelsResponse = {
  models?: unknown
}

type CodexModelsCache = {
  fetchedAt: number
  models: CodexModelInfo[]
}

export type CodexModelRuntimeDefaults = {
  applyPatchToolType?: string
  defaultReasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
  supportedReasoningEfforts?: Array<"none" | "minimal" | "low" | "medium" | "high" | "xhigh">
  supportsReasoningSummaries?: boolean
  reasoningSummaryFormat?: string
  supportsVerbosity?: boolean
  defaultVerbosity?: "low" | "medium" | "high"
}

export type CodexModelCatalogEvent = {
  type:
    | "memory_cache_hit"
    | "disk_cache_hit"
    | "network_fetch_success"
    | "network_fetch_failed"
    | "stale_cache_used"
    | "catalog_unavailable"
  scope: "shared" | "account"
  reason?: string
}

export type GetCodexModelCatalogInput = {
  accessToken?: string
  accountId?: string
  clientVersion?: string
  versionHeader?: string
  originator?: string
  userAgent?: string
  openaiBeta?: string
  now?: () => number
  fetchImpl?: typeof fetch
  forceRefresh?: boolean
  cacheDir?: string
  onEvent?: (event: CodexModelCatalogEvent) => void
}

export type ApplyCodexCatalogInput = {
  providerModels: Record<string, Record<string, unknown>>
  catalogModels?: CodexModelInfo[]
  fallbackModels: string[]
  personality?: PersonalityOption
}

const CODEX_MODELS_ENDPOINT = "https://chatgpt.com/backend-api/codex/models"
const DEFAULT_CACHE_DIR = path.join(os.homedir(), ".config", "opencode", "cache")
const OPENCODE_MODELS_CACHE_PREFIX = "codex-models-cache"
const DEFAULT_CLIENT_VERSION = "0.97.0"
const CACHE_TTL_MS = 15 * 60 * 1000
const FETCH_TIMEOUT_MS = 5000
const EFFORT_SUFFIX_REGEX = /-(none|minimal|low|medium|high|xhigh)$/i
const UNRESOLVED_TEMPLATE_MARKER_REGEX = /\{\{\s*[^}]+\s*\}\}/
const STALE_BRIDGE_MARKERS = [
  /multi_tool_use\.parallel/i,
  /assistant\s+to=multi_tool_use\.parallel/i,
  /functions\.(read|exec_command|write_stdin|apply_patch|edit|grep|glob|list)\b/i,
  /recipient_name\s*[:=]/i
]

const LOCK_OPTIONS = {
  stale: 10_000,
  retries: {
    retries: 20,
    minTimeout: 10,
    maxTimeout: 100
  },
  realpath: false
}

const REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"])
const TEXT_VERBOSITY = new Set(["low", "medium", "high"])

const inMemoryCatalog = new Map<string, CodexModelsCache>()
const inFlightCatalogFetches = new Map<string, Promise<CodexModelInfo[] | undefined>>()

function normalizeAccountId(accountId?: string): string | undefined {
  const next = accountId?.trim()
  return next ? next : undefined
}

function hashAccountId(accountId: string): string {
  return createHash("sha256").update(accountId).digest("hex").slice(0, 16)
}

function cacheKey(cacheDir: string, accountId?: string): string {
  return `${cacheDir}::${normalizeAccountId(accountId) ?? "shared"}`
}

function cachePath(cacheDir: string, accountId?: string): string {
  const normalized = normalizeAccountId(accountId)
  if (!normalized) {
    return path.join(cacheDir, "codex-auth-models-shared.json")
  }
  return path.join(cacheDir, `codex-auth-models-${hashAccountId(normalized)}.json`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeModelSlug(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  return normalized ? normalized : undefined
}

function compareModelSlugs(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
}

function normalizeReasoningEffort(value: unknown): CodexModelRuntimeDefaults["defaultReasoningEffort"] | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (REASONING_EFFORTS.has(normalized)) {
    return normalized as CodexModelRuntimeDefaults["defaultReasoningEffort"]
  }
  return undefined
}

function normalizeVerbosity(value: unknown): CodexModelRuntimeDefaults["defaultVerbosity"] | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (TEXT_VERBOSITY.has(normalized)) {
    return normalized as CodexModelRuntimeDefaults["defaultVerbosity"]
  }
  return undefined
}

function parseReasoningLevels(value: unknown): ModelReasoningLevel[] | null {
  if (!Array.isArray(value)) return null
  const out: ModelReasoningLevel[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const effort = normalizeReasoningEffort(item.effort)
    if (!effort) continue
    out.push({ effort })
  }
  return out.length > 0 ? out : null
}

function parseCatalogResponse(payload: unknown): CodexModelInfo[] {
  if (!isRecord(payload)) return []
  const root = payload as CodexModelsResponse
  if (!Array.isArray(root.models)) return []

  const deduped = new Map<string, CodexModelInfo>()
  for (const item of root.models) {
    if (!isRecord(item)) continue
    const slug = normalizeModelSlug(item.slug)
    if (!slug) continue
    deduped.set(slug, {
      slug,
      model_messages: isRecord(item.model_messages)
        ? {
            instructions_template:
              typeof item.model_messages.instructions_template === "string"
                ? item.model_messages.instructions_template
                : null,
            instructions_variables: isRecord(item.model_messages.instructions_variables)
              ? {
                  personality:
                    typeof item.model_messages.instructions_variables.personality === "string"
                      ? item.model_messages.instructions_variables.personality
                      : null,
                  personality_default:
                    typeof item.model_messages.instructions_variables.personality_default === "string"
                      ? item.model_messages.instructions_variables.personality_default
                      : null,
                  personality_friendly:
                    typeof item.model_messages.instructions_variables.personality_friendly === "string"
                      ? item.model_messages.instructions_variables.personality_friendly
                      : null,
                  personality_pragmatic:
                    typeof item.model_messages.instructions_variables.personality_pragmatic === "string"
                      ? item.model_messages.instructions_variables.personality_pragmatic
                      : null,
                  personalities: isRecord(item.model_messages.instructions_variables.personalities)
                    ? (item.model_messages.instructions_variables.personalities as Record<string, string | null>)
                    : null
                }
              : null
          }
        : null,
      base_instructions: typeof item.base_instructions === "string" ? item.base_instructions : null,
      apply_patch_tool_type:
        typeof item.apply_patch_tool_type === "string" ? item.apply_patch_tool_type : null,
      supported_reasoning_levels: parseReasoningLevels(item.supported_reasoning_levels),
      default_reasoning_level:
        typeof item.default_reasoning_level === "string" ? item.default_reasoning_level : null,
      supports_reasoning_summaries:
        typeof item.supports_reasoning_summaries === "boolean"
          ? item.supports_reasoning_summaries
          : null,
      reasoning_summary_format:
        typeof item.reasoning_summary_format === "string" ? item.reasoning_summary_format : null,
      support_verbosity: typeof item.support_verbosity === "boolean" ? item.support_verbosity : null,
      default_verbosity: typeof item.default_verbosity === "string" ? item.default_verbosity : null
    })
  }

  return Array.from(deduped.values()).sort((a, b) => compareModelSlugs(a.slug, b.slug))
}

function isFresh(cache: CodexModelsCache, now: number): boolean {
  return now - cache.fetchedAt < CACHE_TTL_MS
}

async function withCacheLock<T>(cacheDir: string, fn: () => Promise<T>): Promise<T> {
  await fs.mkdir(cacheDir, { recursive: true })
  const release = await lockfile.lock(cacheDir, LOCK_OPTIONS)
  try {
    return await fn()
  } finally {
    await release()
  }
}

async function readCatalogFromDisk(cacheDir: string, accountId?: string): Promise<CodexModelsCache | undefined> {
  return withCacheLock(cacheDir, async () => {
    try {
      const file = cachePath(cacheDir, accountId)
      const raw = await fs.readFile(file, "utf8")
      const parsed = JSON.parse(raw) as unknown
      if (!isRecord(parsed)) return undefined
      if (typeof parsed.fetchedAt !== "number") return undefined
      const models = parseCatalogResponse({ models: parsed.models })
      return {
        fetchedAt: parsed.fetchedAt,
        models
      }
    } catch {
      return undefined
    }
  })
}

async function readCatalogFromOpencodeCache(cacheDir: string): Promise<CodexModelsCache | undefined> {
  try {
    const entries = await fs.readdir(cacheDir)
    const candidates = entries.filter(
      (name) => name.startsWith(OPENCODE_MODELS_CACHE_PREFIX) && name.endsWith(".json")
    )
    if (candidates.length === 0) return undefined

    let best: CodexModelsCache | undefined
    for (const fileName of candidates) {
      try {
        const raw = await fs.readFile(path.join(cacheDir, fileName), "utf8")
        const parsed = JSON.parse(raw) as unknown
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
      } catch {
        // Best effort parse; skip malformed cache files.
      }
    }

    return best
  } catch {
    return undefined
  }
}

async function writeCatalogToDisk(cacheDir: string, accountId: string | undefined, cache: CodexModelsCache): Promise<void> {
  await withCacheLock(cacheDir, async () => {
    const file = cachePath(cacheDir, accountId)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 })
    await fs.chmod(file, 0o600).catch(() => {})
  }).catch(() => {
    // Best effort cache persistence.
  })
}

function emitEvent(input: GetCodexModelCatalogInput, event: Omit<CodexModelCatalogEvent, "scope">): void {
  try {
    input.onEvent?.({
      ...event,
      scope: normalizeAccountId(input.accountId) ? "account" : "shared"
    })
  } catch {
    // Keep catalog path side-effect free.
  }
}

function deriveReason(value: unknown): string {
  if (value instanceof Error) {
    return value.name || "error"
  }
  return "error"
}

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
  const cacheDir = input.cacheDir ?? DEFAULT_CACHE_DIR
  const key = cacheKey(cacheDir, input.accountId)

  const memory = inMemoryCatalog.get(key)
  if (memory && !input.forceRefresh && isFresh(memory, now)) {
    emitEvent(input, { type: "memory_cache_hit" })
    return memory.models
  }

  const disk = await readCatalogFromDisk(cacheDir, input.accountId)
  const opencodeCacheFallback = await readCatalogFromOpencodeCache(cacheDir)
  const hasFreshDisk = !!disk && isFresh(disk, now)
  if (hasFreshDisk && !input.forceRefresh) {
    inMemoryCatalog.set(key, disk)
    emitEvent(input, { type: "disk_cache_hit" })
    return disk.models
  }

  if (!input.accessToken) {
    if (disk) {
      emitEvent(input, { type: "stale_cache_used", reason: "missing_access_token" })
      inMemoryCatalog.set(key, disk)
      return disk.models
    }
    if (opencodeCacheFallback) {
      emitEvent(input, { type: "stale_cache_used", reason: "opencode_cache_fallback" })
      inMemoryCatalog.set(key, opencodeCacheFallback)
      return opencodeCacheFallback.models
    }
    emitEvent(input, { type: "catalog_unavailable", reason: "missing_access_token" })
    return undefined
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${input.accessToken}`,
    originator: input.originator?.trim() || "opencode"
  }
  const clientVersion = normalizeClientVersion(input.clientVersion, input.versionHeader)
  const versionHeader = normalizeClientVersion(input.versionHeader, input.clientVersion)
  if (versionHeader) headers.version = versionHeader
  const userAgent = input.userAgent?.trim()
  if (userAgent) headers["user-agent"] = userAgent
  const betaValue = input.openaiBeta?.trim()
  if (betaValue) headers["openai-beta"] = betaValue
  const accountId = normalizeAccountId(input.accountId)
  if (accountId) {
    headers["chatgpt-account-id"] = accountId
  }

  const existingInFlight = inFlightCatalogFetches.get(key)
  if (existingInFlight) {
    return existingInFlight
  }

  const fetchImpl = input.fetchImpl ?? fetch
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

      const payload = (await response.json()) as unknown
      const models = parseCatalogResponse(payload)
      if (models.length === 0) {
        throw new Error("codex models response did not contain usable models")
      }

      const nextCache: CodexModelsCache = {
        fetchedAt: now,
        models
      }
      inMemoryCatalog.set(key, nextCache)
      await writeCatalogToDisk(cacheDir, accountId, nextCache)
      emitEvent(input, { type: "network_fetch_success" })
      return nextCache.models
    } catch (error) {
      emitEvent(input, { type: "network_fetch_failed", reason: deriveReason(error) })
      if (disk) {
        inMemoryCatalog.set(key, disk)
        emitEvent(input, { type: "stale_cache_used", reason: "network_fetch_failed" })
        return disk.models
      }
      if (opencodeCacheFallback) {
        inMemoryCatalog.set(key, opencodeCacheFallback)
        emitEvent(input, { type: "stale_cache_used", reason: "opencode_cache_fallback" })
        return opencodeCacheFallback.models
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

function cloneModelTemplate(template: Record<string, unknown>, slug: string): Record<string, unknown> {
  const cloned = { ...template }
  setModelIdentityFields(cloned, slug)
  return cloned
}

function formatModelDisplayNameFromSlug(slug: string): string {
  const tokens = slug
    .trim()
    .split("-")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  if (tokens.length === 0) return slug

  const words = tokens.map((token) => {
    if (token.toLowerCase() === "gpt") return "GPT"
    if (token.length === 1) return token.toUpperCase()
    return `${token.charAt(0).toUpperCase()}${token.slice(1).toLowerCase()}`
  })

  if (words[0] === "GPT" && words.length > 1) {
    return [`${words[0]}-${words[1]}`, ...words.slice(2)].join(" ")
  }

  return words.join(" ")
}

function setModelIdentityFields(model: Record<string, unknown>, slug: string): void {
  const display = formatModelDisplayNameFromSlug(slug)

  for (const key of ["id", "slug", "model"]) {
    model[key] = slug
  }
  for (const key of ["name", "displayName", "display_name"]) {
    model[key] = display
  }
}

function resolvePersonalityText(
  model: CodexModelInfo,
  personality: PersonalityOption | undefined
): string | undefined {
  const vars = model.model_messages?.instructions_variables

  const normalized = (personality ?? "none").trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized !== "none") {
    const fromFile = resolveCustomPersonalityDescription(normalized)
    if (typeof fromFile === "string" && fromFile.trim()) {
      return fromFile
    }
  }

  if (!vars) return undefined
  if (vars.personalities && typeof vars.personalities === "object") {
    const fromMap = vars.personalities[normalized] ?? vars.personalities.default
    if (typeof fromMap === "string" && fromMap.trim()) {
      return fromMap
    }
  }

  if (normalized === "friendly" && typeof vars.personality_friendly === "string" && vars.personality_friendly.trim()) {
    return vars.personality_friendly
  }
  if (normalized === "pragmatic" && typeof vars.personality_pragmatic === "string" && vars.personality_pragmatic.trim()) {
    return vars.personality_pragmatic
  }

  if (typeof vars.personality_default === "string" && vars.personality_default.trim()) {
    return vars.personality_default
  }
  if (typeof vars.personality === "string" && vars.personality.trim()) {
    return vars.personality
  }
  return undefined
}

function isCompatibleInstructionsText(value: string): boolean {
  if (UNRESOLVED_TEMPLATE_MARKER_REGEX.test(value)) return false
  return !STALE_BRIDGE_MARKERS.some((pattern) => pattern.test(value))
}

function normalizeSafeInstructions(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return isCompatibleInstructionsText(trimmed) ? trimmed : undefined
}

export function resolveInstructionsForModel(
  model: CodexModelInfo,
  personality?: PersonalityOption
): string | undefined {
  const template = model.model_messages?.instructions_template?.trim()
  const base = model.base_instructions?.trim()
  const safeBase = normalizeSafeInstructions(base)

  if (!template) {
    return safeBase
  }

  const personalityText = resolvePersonalityText(model, personality) ?? ""
  if (!template.includes("{{") && !template.includes("}}")) {
    return normalizeSafeInstructions(template) ?? safeBase
  }

  const rendered = template
    .replace(/\{\{\s*personality\s*\}\}/gi, personalityText)
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  return normalizeSafeInstructions(rendered) ?? safeBase
}

function resolveAllowedSlugs(catalogModels: CodexModelInfo[] | undefined, fallback: string[]): string[] {
  const preferred = (catalogModels ?? []).map((model) => model.slug).filter((slug) => slug.length > 0)
  if (preferred.length > 0) {
    return Array.from(new Set(preferred)).sort(compareModelSlugs)
  }
  return Array.from(new Set(fallback.map((slug) => slug.trim().toLowerCase()).filter(Boolean))).sort(compareModelSlugs)
}

function resolveTemplateSource(providerModels: Record<string, Record<string, unknown>>): Record<string, unknown> | undefined {
  for (const candidate of ["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex", "gpt-5.2"]) {
    const found = providerModels[candidate]
    if (found) return found
  }
  const first = Object.values(providerModels)[0]
  return first
}

function stripEffortSuffix(slug: string): string {
  return slug.replace(EFFORT_SUFFIX_REGEX, "")
}

function ensureModelOptions(model: Record<string, unknown>): Record<string, unknown> {
  const existing = model.options
  if (isRecord(existing)) return existing
  const options: Record<string, unknown> = {}
  model.options = options
  return options
}

function findModelBySlug(catalogModels: CodexModelInfo[] | undefined, slug: string): CodexModelInfo | undefined {
  if (!catalogModels || catalogModels.length === 0) return undefined
  const normalized = slug.trim().toLowerCase()
  const exact = catalogModels.find((item) => item.slug === normalized)
  if (exact) return exact
  const base = stripEffortSuffix(normalized)
  return catalogModels.find((item) => item.slug === base)
}

export function getRuntimeDefaultsForModel(model: CodexModelInfo | undefined): CodexModelRuntimeDefaults | undefined {
  if (!model) return undefined

  const out: CodexModelRuntimeDefaults = {}

  if (typeof model.apply_patch_tool_type === "string") {
    const next = model.apply_patch_tool_type.trim()
    if (next) out.applyPatchToolType = next
  }

  const defaultReasoningEffort = normalizeReasoningEffort(model.default_reasoning_level)
  if (defaultReasoningEffort) {
    out.defaultReasoningEffort = defaultReasoningEffort
  }

  const supportedReasoningEfforts = Array.from(
    new Set(
      (model.supported_reasoning_levels ?? [])
        .map((level) => normalizeReasoningEffort(level.effort))
        .filter((value): value is NonNullable<typeof value> => value !== undefined)
    )
  )
  if (supportedReasoningEfforts.length > 0) {
    out.supportedReasoningEfforts = supportedReasoningEfforts
  }

  if (typeof model.supports_reasoning_summaries === "boolean") {
    out.supportsReasoningSummaries = model.supports_reasoning_summaries
  }

  if (typeof model.reasoning_summary_format === "string") {
    const next = model.reasoning_summary_format.trim()
    if (next) out.reasoningSummaryFormat = next
  }

  if (typeof model.support_verbosity === "boolean") {
    out.supportsVerbosity = model.support_verbosity
  }

  const defaultVerbosity = normalizeVerbosity(model.default_verbosity)
  if (defaultVerbosity) {
    out.defaultVerbosity = defaultVerbosity
  }

  return Object.keys(out).length > 0 ? out : undefined
}

export function getRuntimeDefaultsForSlug(
  slug: string,
  catalogModels: CodexModelInfo[] | undefined
): CodexModelRuntimeDefaults | undefined {
  const model = findModelBySlug(catalogModels, slug)
  return getRuntimeDefaultsForModel(model)
}

export function applyCodexCatalogToProviderModels(input: ApplyCodexCatalogInput): void {
  const allowedSlugs = resolveAllowedSlugs(input.catalogModels, input.fallbackModels)
  const allowed = new Set(allowedSlugs)
  const bySlug = new Map((input.catalogModels ?? []).map((model) => [model.slug, model]))

  const templateSource = resolveTemplateSource(input.providerModels)

  for (const slug of allowedSlugs) {
    if (!input.providerModels[slug]) {
      if (templateSource) {
        input.providerModels[slug] = cloneModelTemplate(templateSource, slug)
      } else {
        input.providerModels[slug] = { id: slug, model: slug }
      }
    } else {
      setModelIdentityFields(input.providerModels[slug], slug)
    }

    const catalogModel = bySlug.get(slug)
    const options = ensureModelOptions(input.providerModels[slug])
    if (catalogModel) {
      const instructions = resolveInstructionsForModel(catalogModel, input.personality)
      options.codexCatalogModel = catalogModel
      if (instructions) {
        input.providerModels[slug].instructions = instructions
        options.codexInstructions = instructions
      } else {
        delete options.codexInstructions
      }
    } else {
      delete options.codexCatalogModel
    }

    const runtimeDefaults = getRuntimeDefaultsForSlug(slug, input.catalogModels)
    if (runtimeDefaults) {
      input.providerModels[slug].codexRuntimeDefaults = runtimeDefaults
      options.codexRuntimeDefaults = runtimeDefaults
    } else {
      delete input.providerModels[slug].codexRuntimeDefaults
      delete options.codexRuntimeDefaults
    }
  }

  for (const modelId of Object.keys(input.providerModels)) {
    if (!allowed.has(modelId)) {
      delete input.providerModels[modelId]
    }
  }

  const orderedModelIds = Object.keys(input.providerModels).sort((a, b) => b.localeCompare(a))
  if (orderedModelIds.length > 1) {
    const orderedEntries = orderedModelIds.map((modelId) => [modelId, input.providerModels[modelId]] as const)
    for (const modelId of Object.keys(input.providerModels)) {
      delete input.providerModels[modelId]
    }
    for (const [modelId, model] of orderedEntries) {
      if (model) {
        input.providerModels[modelId] = model
      }
    }
  }

  for (const model of Object.values(input.providerModels)) {
    model.cost = {
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 }
    }
  }
}
