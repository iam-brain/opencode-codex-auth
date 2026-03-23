import { resolveCustomPersonalityDescription } from "../personalities.js"
import {
  type ApplyCodexCatalogInput,
  type CustomModelBehaviorConfig,
  type CodexModelInfo,
  type CodexModelRuntimeDefaults,
  compareModelSlugs,
  EFFORT_SUFFIX_REGEX,
  normalizeReasoningEffort,
  normalizeVerbosity,
  type PersonalityOption
} from "./shared.js"

const DEFAULT_OPENAI_NPM = "@ai-sdk/openai"
const DEFAULT_OPENAI_API_URL = "https://chatgpt.com/backend-api/codex"
const DEFAULT_OUTPUT_TOKEN_LIMIT = 128_000
const DEFAULT_OUTPUT_CAPABILITIES = {
  text: true,
  audio: false,
  image: false,
  video: false,
  pdf: false
}
const DEFAULT_INPUT_CAPABILITIES = {
  text: true,
  audio: false,
  image: false,
  video: false,
  pdf: false
}
const UNRESOLVED_TEMPLATE_MARKER_REGEX = /\{\{\s*[^}]+\s*\}\}/
const STALE_BRIDGE_MARKERS = [
  /multi_tool_use\.parallel/i,
  /assistant\s+to=multi_tool_use\.parallel/i,
  /functions\.(read|exec_command|write_stdin|apply_patch|edit|grep|glob|list)\b/i,
  /recipient_name\s*[:=]/i
]

type ProviderTransport = {
  providerID: string
  apiUrl: string
  apiNpm: string
  status: string
  headers: Record<string, string>
}

type CapabilityMap = typeof DEFAULT_INPUT_CAPABILITIES

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
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

function isRawCatalogSlugDisplayName(slug: string, displayName: string): boolean {
  return displayName.trim().toLowerCase() === slug.trim().toLowerCase()
}

function resolveDisplayName(slug: string, catalogDisplayName?: string | null): string {
  const trimmed = catalogDisplayName?.trim()
  if (!trimmed) return formatModelDisplayNameFromSlug(slug)
  if (isRawCatalogSlugDisplayName(slug, trimmed)) return formatModelDisplayNameFromSlug(slug)
  return trimmed
}

function resolveProviderTransport(
  providerModels: Record<string, Record<string, unknown>>,
  existingModel?: Record<string, unknown>
): ProviderTransport {
  const source = existingModel ?? {}
  const api = asRecord(source.api)

  return {
    providerID: asString(source.providerID) ?? "openai",
    apiUrl: asString(api?.url) ?? DEFAULT_OPENAI_API_URL,
    apiNpm: asString(api?.npm) ?? DEFAULT_OPENAI_NPM,
    status: asString(source.status) ?? "active",
    headers: Object.fromEntries(
      Object.entries(asRecord(source.headers) ?? {}).filter((entry): entry is [string, string] => {
        return typeof entry[1] === "string"
      })
    )
  }
}

function resolveFamily(slug: string): string {
  if (slug.includes("codex")) return "gpt-codex"
  if (slug.startsWith("gpt-")) return "gpt-5"
  if (slug.startsWith("o")) return "o-series"
  return "openai"
}

function readCapabilityMap(value: unknown, fallback: CapabilityMap): CapabilityMap {
  const source = asRecord(value)
  return {
    text: source?.text !== false,
    audio: source?.audio === true,
    image: source?.image === true,
    video: source?.video === true,
    pdf: source?.pdf === true
  }
}

function buildInputCapabilities(model: CodexModelInfo): CapabilityMap {
  const modalities = new Set(model.input_modalities ?? ["text"])
  return {
    text: modalities.has("text"),
    audio: modalities.has("audio"),
    image: modalities.has("image"),
    video: modalities.has("video"),
    pdf: modalities.has("pdf")
  }
}

function buildVariants(model: CodexModelInfo): Record<string, Record<string, unknown>> {
  const efforts = Array.from(
    new Set(
      (model.supported_reasoning_levels ?? [])
        .map((level) => normalizeReasoningEffort(level.effort))
        .filter((value): value is NonNullable<typeof value> => value !== undefined)
    )
  )

  return Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }]))
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry)) as T
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, cloneValue(entry)])
    ) as T
  }
  return value
}

function mergeVariantMaps(
  baseVariants: Record<string, Record<string, unknown>> | undefined,
  overlayVariants: CustomModelBehaviorConfig["variants"] | undefined
): Record<string, Record<string, unknown>> | undefined {
  const nextVariants: Record<string, Record<string, unknown>> = {}

  for (const [variantName, variantValue] of Object.entries(baseVariants ?? {})) {
    nextVariants[variantName] = cloneValue(variantValue)
  }

  for (const [variantName, variantValue] of Object.entries(overlayVariants ?? {})) {
    nextVariants[variantName] = {
      ...(nextVariants[variantName] ?? {}),
      ...cloneValue(variantValue ?? {})
    }
  }

  return Object.keys(nextVariants).length > 0 ? nextVariants : undefined
}

function buildProviderModelFromCatalog(
  model: CodexModelInfo,
  providerModels: Record<string, Record<string, unknown>>,
  existingModel?: Record<string, unknown>
): Record<string, unknown> | undefined {
  const display = resolveDisplayName(model.slug, model.display_name)
  const transport = resolveProviderTransport(providerModels, existingModel)
  const inputCapabilities = buildInputCapabilities(model)
  const outputCapabilities = readCapabilityMap(undefined, DEFAULT_OUTPUT_CAPABILITIES)
  const attachment =
    inputCapabilities.audio || inputCapabilities.image || inputCapabilities.video || inputCapabilities.pdf
  const hasReasoning =
    (model.supported_reasoning_levels?.length ?? 0) > 0 ||
    normalizeReasoningEffort(model.default_reasoning_level) !== undefined ||
    model.supports_reasoning_summaries === true
  const contextWindow = asFiniteNumber(model.context_window)
  if (contextWindow === undefined) return undefined
  const outputLimit = DEFAULT_OUTPUT_TOKEN_LIMIT
  const variants = buildVariants(model)

  return {
    id: model.slug,
    slug: model.slug,
    model: model.slug,
    name: display,
    displayName: display,
    display_name: display,
    providerID: transport.providerID,
    api: {
      id: model.slug,
      url: transport.apiUrl,
      npm: transport.apiNpm
    },
    status: transport.status,
    headers: { ...transport.headers },
    options: {},
    cost: {
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 }
    },
    limit: {
      context: contextWindow,
      input: contextWindow,
      output: outputLimit
    },
    capabilities: {
      temperature: false,
      reasoning: hasReasoning,
      attachment,
      toolcall: true,
      input: inputCapabilities,
      output: outputCapabilities,
      interleaved: false
    },
    family: resolveFamily(model.slug),
    release_date: "",
    variants
  }
}

function buildCustomProviderModel(input: {
  slug: string
  config: CustomModelBehaviorConfig
  targetModel: Record<string, unknown>
}): Record<string, unknown> {
  const nextModel = cloneValue(input.targetModel)
  nextModel.id = input.slug
  nextModel.slug = input.slug
  nextModel.model = input.slug

  if (input.config.name) {
    nextModel.name = input.config.name
    nextModel.displayName = input.config.name
    nextModel.display_name = input.config.name
  }

  const api =
    typeof nextModel.api === "object" && nextModel.api !== null && !Array.isArray(nextModel.api)
      ? (nextModel.api as Record<string, unknown>)
      : {}
  api.id = input.config.targetModel
  nextModel.api = api

  nextModel.variants = mergeVariantMaps(
    asRecord(nextModel.variants) as Record<string, Record<string, unknown>> | undefined,
    input.config.variants
  )

  const options = ensureModelOptions(nextModel)
  options.codexCustomModelConfig = cloneValue({
    slug: input.slug,
    ...input.config
  })

  return nextModel
}

function resolvePersonalityText(
  model: CodexModelInfo,
  personality: PersonalityOption | undefined,
  options: { projectRoot?: string; configRoot?: string } = {}
): string | undefined {
  const vars = model.model_messages?.instructions_variables

  const normalized = (personality ?? "none").trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized !== "none") {
    const fromFile = resolveCustomPersonalityDescription(normalized, options)
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
  if (
    normalized === "pragmatic" &&
    typeof vars.personality_pragmatic === "string" &&
    vars.personality_pragmatic.trim()
  ) {
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
  personality?: PersonalityOption,
  options: { projectRoot?: string; configRoot?: string } = {}
): string | undefined {
  const template = model.model_messages?.instructions_template?.trim()
  const base = model.base_instructions?.trim()
  const safeBase = normalizeSafeInstructions(base)
  if (!template) return safeBase

  if (!template.includes("{{") && !template.includes("}}")) {
    return normalizeSafeInstructions(template) ?? safeBase
  }

  const personalityText = resolvePersonalityText(model, personality, options) ?? ""
  const rendered = template
    .replace(/\{\{\s*personality\s*\}\}/gi, personalityText)
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  return normalizeSafeInstructions(rendered) ?? safeBase
}

function stripEffortSuffix(slug: string): string {
  return slug.replace(EFFORT_SUFFIX_REGEX, "")
}

function ensureModelOptions(model: Record<string, unknown>): Record<string, unknown> {
  const existing = model.options
  if (typeof existing === "object" && existing !== null && !Array.isArray(existing)) {
    return existing as Record<string, unknown>
  }
  const options: Record<string, unknown> = {}
  model.options = options
  return options
}

function clearCatalogInstructionState(model: Record<string, unknown>, options: Record<string, unknown>): void {
  const priorInstructions = typeof options.codexInstructions === "string" ? options.codexInstructions : undefined
  if (priorInstructions && model.instructions === priorInstructions) {
    delete model.instructions
  }
  delete options.codexInstructions
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

  if (typeof model.default_reasoning_summary === "string") {
    const next = model.default_reasoning_summary.trim()
    if (next) out.defaultReasoningSummary = next
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

  if (typeof model.supports_parallel_tool_calls === "boolean") {
    out.supportsParallelToolCalls = model.supports_parallel_tool_calls
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
  const catalogModels = input.catalogModels
  if (catalogModels === undefined) {
    return
  }
  if (catalogModels.length === 0) {
    for (const modelId of Object.keys(input.providerModels)) {
      delete input.providerModels[modelId]
    }
    return
  }

  const allowedSlugs = Array.from(new Set(catalogModels.map((model) => model.slug))).sort(compareModelSlugs)
  const allowed = new Set(allowedSlugs)
  const bySlug = new Map(catalogModels.map((model) => [model.slug, model]))
  const customTargetBySlug = new Map<string, string>()

  for (const slug of allowedSlugs) {
    const catalogModel = bySlug.get(slug)
    if (!catalogModel) continue

    const existingModel = input.providerModels[slug]
    const nextModel = buildProviderModelFromCatalog(catalogModel, input.providerModels, existingModel)
    if (!nextModel) {
      delete input.providerModels[slug]
      continue
    }
    input.providerModels[slug] = nextModel

    const options = ensureModelOptions(input.providerModels[slug])
    const instructions = resolveInstructionsForModel(catalogModel, input.personality, {
      projectRoot: input.projectRoot,
      configRoot: input.configRoot
    })
    options.codexCatalogModel = catalogModel
    if (instructions) {
      input.providerModels[slug].instructions = instructions
      options.codexInstructions = instructions
    } else {
      clearCatalogInstructionState(input.providerModels[slug], options)
    }

    const runtimeDefaults = getRuntimeDefaultsForSlug(slug, catalogModels)
    if (runtimeDefaults) {
      input.providerModels[slug].codexRuntimeDefaults = runtimeDefaults
      options.codexRuntimeDefaults = runtimeDefaults
    } else {
      delete input.providerModels[slug].codexRuntimeDefaults
      delete options.codexRuntimeDefaults
    }
  }

  for (const [slug, customModel] of Object.entries(input.customModels ?? {})) {
    const targetSlug = customModel.targetModel.trim().toLowerCase()
    const targetModel = input.providerModels[targetSlug]
    if (!targetModel) {
      input.warn?.(
        `[opencode-codex-auth] customModels.${slug}.targetModel points to ${JSON.stringify(customModel.targetModel)}, but that model was not present in the active Codex catalog. Skipping custom model synthesis.`
      )
      delete input.providerModels[slug]
      continue
    }

    input.providerModels[slug] = buildCustomProviderModel({
      slug,
      config: customModel,
      targetModel
    })
    allowed.add(slug)
    customTargetBySlug.set(slug, targetSlug)
  }

  for (const modelId of Object.keys(input.providerModels)) {
    if (!allowed.has(modelId)) {
      delete input.providerModels[modelId]
    }
  }

  const orderedModelIds = Object.keys(input.providerModels).sort((a, b) => {
    const aPriority = bySlug.get(a)?.priority ?? bySlug.get(customTargetBySlug.get(a) ?? "")?.priority
    const bPriority = bySlug.get(b)?.priority ?? bySlug.get(customTargetBySlug.get(b) ?? "")?.priority
    const normalizedAPriority =
      typeof aPriority === "number" && Number.isFinite(aPriority) ? aPriority : Number.POSITIVE_INFINITY
    const normalizedBPriority =
      typeof bPriority === "number" && Number.isFinite(bPriority) ? bPriority : Number.POSITIVE_INFINITY
    if (normalizedAPriority !== normalizedBPriority) {
      return normalizedAPriority - normalizedBPriority
    }
    return compareModelSlugs(b, a)
  })
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
