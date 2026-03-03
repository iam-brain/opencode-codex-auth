import { resolveCustomPersonalityDescription } from "../personalities.js"
import {
  type ApplyCodexCatalogInput,
  type CodexModelInfo,
  type CodexModelRuntimeDefaults,
  compareModelSlugs,
  EFFORT_SUFFIX_REGEX,
  normalizeReasoningEffort,
  normalizeVerbosity,
  type PersonalityOption
} from "./shared.js"

const UNRESOLVED_TEMPLATE_MARKER_REGEX = /\{\{\s*[^}]+\s*\}\}/
const STALE_BRIDGE_MARKERS = [
  /multi_tool_use\.parallel/i,
  /assistant\s+to=multi_tool_use\.parallel/i,
  /functions\.(read|exec_command|write_stdin|apply_patch|edit|grep|glob|list)\b/i,
  /recipient_name\s*[:=]/i
]

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

function resolvePersonalityText(model: CodexModelInfo, personality: PersonalityOption | undefined): string | undefined {
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
  personality?: PersonalityOption
): string | undefined {
  const template = model.model_messages?.instructions_template?.trim()
  const base = model.base_instructions?.trim()
  const safeBase = normalizeSafeInstructions(base)
  if (!template) return safeBase

  if (!template.includes("{{") && !template.includes("}}")) {
    return normalizeSafeInstructions(template) ?? safeBase
  }

  const personalityText = resolvePersonalityText(model, personality) ?? ""
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

function resolveTemplateSource(
  providerModels: Record<string, Record<string, unknown>>
): Record<string, unknown> | undefined {
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
  if (typeof existing === "object" && existing !== null && !Array.isArray(existing)) {
    return existing as Record<string, unknown>
  }
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
