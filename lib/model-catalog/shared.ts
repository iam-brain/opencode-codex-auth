export type PersonalityOption = string
export type CustomModelBehaviorConfig = {
  targetModel: string
  name?: string
  personality?: string
  reasoningEffort?: string
  reasoningSummary?: "auto" | "concise" | "detailed" | "none"
  textVerbosity?: "default" | "low" | "medium" | "high" | "none"
  serviceTier?: "auto" | "priority" | "flex"
  include?: Array<"reasoning.encrypted_content" | "file_search_call.results" | "message.output_text.logprobs">
  parallelToolCalls?: boolean
  variants?: Record<
    string,
    {
      personality?: string
      reasoningEffort?: string
      reasoningSummary?: "auto" | "concise" | "detailed" | "none"
      textVerbosity?: "default" | "low" | "medium" | "high" | "none"
      serviceTier?: "auto" | "priority" | "flex"
      include?: Array<"reasoning.encrypted_content" | "file_search_call.results" | "message.output_text.logprobs">
      parallelToolCalls?: boolean
    }
  >
}

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

type CatalogInputModality = "text" | "audio" | "image" | "video" | "pdf"

export type CodexModelInfo = {
  slug: string
  display_name?: string | null
  priority?: number | null
  context_window?: number | null
  input_modalities?: readonly CatalogInputModality[] | null
  model_messages?: ModelMessages | null
  base_instructions?: string | null
  apply_patch_tool_type?: string | null
  supported_reasoning_levels?: ModelReasoningLevel[] | null
  default_reasoning_level?: string | null
  supports_reasoning_summaries?: boolean | null
  reasoning_summary_format?: string | null
  supports_parallel_tool_calls?: boolean | null
  support_verbosity?: boolean | null
  default_verbosity?: string | null
  default_reasoning_summary?: string | null
}

type CodexModelsResponse = {
  models?: unknown
}

export type CodexModelsCache = {
  fetchedAt: number
  models: CodexModelInfo[]
  staleFallback?: boolean
}

export type CodexModelRuntimeDefaults = {
  applyPatchToolType?: string
  defaultReasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
  defaultReasoningSummary?: string
  supportedReasoningEfforts?: Array<"none" | "minimal" | "low" | "medium" | "high" | "xhigh">
  supportsReasoningSummaries?: boolean
  reasoningSummaryFormat?: string
  supportsParallelToolCalls?: boolean
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
  refreshGithubModelsCache?: boolean
  onEvent?: (event: CodexModelCatalogEvent) => void
}

export type ApplyCodexCatalogInput = {
  providerModels: Record<string, Record<string, unknown>>
  catalogModels?: CodexModelInfo[]
  personality?: PersonalityOption
  projectRoot?: string
  configRoot?: string
  customModels?: Record<string, CustomModelBehaviorConfig>
  warn?: (message: string) => void
}

export const CODEX_MODELS_ENDPOINT = "https://chatgpt.com/backend-api/codex/models"
export const CODEX_GITHUB_MODELS_URL_PREFIX = "https://raw.githubusercontent.com/openai/codex"
export const DEFAULT_CLIENT_VERSION = "0.116.0"
export const CACHE_TTL_MS = 15 * 60 * 1000
export const FETCH_TIMEOUT_MS = 5000
export const EFFORT_SUFFIX_REGEX = /-(none|minimal|low|medium|high|xhigh)$/i

const REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"])
const TEXT_VERBOSITY = new Set(["low", "medium", "high"])
const INPUT_MODALITIES = new Set<CatalogInputModality>(["text", "audio", "image", "video", "pdf"])

export type GitHubModelsCacheMeta = {
  etag?: string
  tag: string
  lastChecked: number
  url: string
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function normalizeModelSlug(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  return normalized ? normalized : undefined
}

export function compareModelSlugs(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
}

export function normalizeReasoningEffort(
  value: unknown
): CodexModelRuntimeDefaults["defaultReasoningEffort"] | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (REASONING_EFFORTS.has(normalized)) {
    return normalized as CodexModelRuntimeDefaults["defaultReasoningEffort"]
  }
  return undefined
}

export function normalizeVerbosity(value: unknown): CodexModelRuntimeDefaults["defaultVerbosity"] | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (TEXT_VERBOSITY.has(normalized)) {
    return normalized as CodexModelRuntimeDefaults["defaultVerbosity"]
  }
  return undefined
}

export function parseReasoningLevels(value: unknown): ModelReasoningLevel[] | null {
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

function parseInputModalities(value: unknown): CatalogInputModality[] | null {
  if (!Array.isArray(value)) return null
  const out: CatalogInputModality[] = []
  for (const item of value) {
    if (typeof item !== "string") continue
    const normalized = item.trim().toLowerCase()
    if (INPUT_MODALITIES.has(normalized as CatalogInputModality)) {
      out.push(normalized as CatalogInputModality)
    }
  }
  return out.length > 0 ? Array.from(new Set(out)) : null
}

export function parseCatalogResponse(payload: unknown): CodexModelInfo[] {
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
      display_name: typeof item.display_name === "string" ? item.display_name : null,
      priority: typeof item.priority === "number" && Number.isFinite(item.priority) ? item.priority : null,
      context_window:
        typeof item.context_window === "number" && Number.isFinite(item.context_window) ? item.context_window : null,
      input_modalities: parseInputModalities(item.input_modalities),
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
      apply_patch_tool_type: typeof item.apply_patch_tool_type === "string" ? item.apply_patch_tool_type : null,
      supported_reasoning_levels: parseReasoningLevels(item.supported_reasoning_levels),
      default_reasoning_level: typeof item.default_reasoning_level === "string" ? item.default_reasoning_level : null,
      supports_reasoning_summaries:
        typeof item.supports_reasoning_summaries === "boolean" ? item.supports_reasoning_summaries : null,
      reasoning_summary_format:
        typeof item.reasoning_summary_format === "string" ? item.reasoning_summary_format : null,
      supports_parallel_tool_calls:
        typeof item.supports_parallel_tool_calls === "boolean" ? item.supports_parallel_tool_calls : null,
      support_verbosity: typeof item.support_verbosity === "boolean" ? item.support_verbosity : null,
      default_verbosity: typeof item.default_verbosity === "string" ? item.default_verbosity : null,
      default_reasoning_summary:
        typeof item.default_reasoning_summary === "string" ? item.default_reasoning_summary : null
    })
  }

  return Array.from(deduped.values()).sort((a, b) => compareModelSlugs(a.slug, b.slug))
}

export function parseFetchedAtFromUnknown(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }
  return 0
}

export function parseSemver(value: unknown): [number, number, number] | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  const match = trimmed.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match) return undefined
  return [Number.parseInt(match[1], 10), Number.parseInt(match[2], 10), Number.parseInt(match[3], 10)]
}

export function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0]
  if (a[1] !== b[1]) return a[1] - b[1]
  return a[2] - b[2]
}

export function normalizeSemver(value: string | undefined): string | undefined {
  const parsed = parseSemver(value)
  if (!parsed) return undefined
  return `${parsed[0]}.${parsed[1]}.${parsed[2]}`
}

export function githubModelsTag(version: string): string {
  return `rust-v${version}`
}

export function githubModelsUrl(version: string): string {
  return `${CODEX_GITHUB_MODELS_URL_PREFIX}/${githubModelsTag(version)}/codex-rs/core/models.json`
}

export function semverFromTag(tag: string | undefined): string | undefined {
  if (!tag) return undefined
  const match = tag.match(/(\d+\.\d+\.\d+)/)
  if (!match?.[1]) return undefined
  return normalizeSemver(match[1])
}
