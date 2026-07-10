import type { CodexModelInfo } from "../model-catalog.js"

const ULTRA_REASONING_EFFORT = "ultra"
const ULTRA_WIRE_REASONING_EFFORT = "max"
const ULTRA_MULTI_AGENT_VERSION = "v2"

export type UltraDelegationPolicy = "proactive" | "explicit_request_only"

export type UltraEligibilityReason =
  | "eligible"
  | "missing_catalog"
  | "missing_ultra_effort"
  | "missing_multi_agent_v2"
  | "not_supported_in_api"
  | "not_visible"

const ULTRA_ELIGIBILITY_REASONS = new Set<UltraEligibilityReason>([
  "eligible",
  "missing_catalog",
  "missing_ultra_effort",
  "missing_multi_agent_v2",
  "not_supported_in_api",
  "not_visible"
])

export type UltraResolution = {
  selected: boolean
  logicalEffort: string | undefined
  wireEffort: string | undefined
  eligible: boolean
  delegationPolicy: UltraDelegationPolicy
  reason: UltraEligibilityReason
  modelSlug?: string
  multiAgentVersion?: string
}

export const ULTRA_PROACTIVE_INSTRUCTIONS = `# Ultra Delegation

When independent work can materially improve speed or quality, proactively delegate it to available task or subagent tools. Keep delegation focused: do not delegate trivial, dependent, or sensitive work without a clear benefit. If task tools are unavailable, disabled, or fail, continue the work yourself without claiming that delegation happened.`

export const ULTRA_EXPLICIT_ONLY_INSTRUCTIONS = `# Ultra Child Delegation

Use maximum reasoning for this task, but do not proactively delegate. Spawn or use child task tools only when the user, AGENTS.md, or an installed skill explicitly requests delegation. If a requested child task fails or is unavailable, continue with the work you can complete yourself.`

function normalize(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim().toLowerCase()
  return trimmed || undefined
}

function supportsEffort(model: CodexModelInfo, effort: string): boolean {
  return (model.supported_reasoning_levels ?? []).some((level) => normalize(level.effort) === effort)
}

function modelIsVisible(model: CodexModelInfo): boolean {
  const visibility = normalize(model.visibility)
  return visibility === "list"
}

function getUltraEligibilityReason(model: CodexModelInfo | undefined): UltraEligibilityReason {
  if (!model) return "missing_catalog"
  if (model.catalog_source === "github_fallback") return "missing_catalog"
  if (!supportsEffort(model, ULTRA_REASONING_EFFORT)) return "missing_ultra_effort"
  if (normalize(model.multi_agent_version) !== ULTRA_MULTI_AGENT_VERSION) return "missing_multi_agent_v2"
  if (model.supported_in_api !== true) return "not_supported_in_api"
  if (!modelIsVisible(model)) return "not_visible"
  return "eligible"
}

export function isUltraEligible(model: CodexModelInfo | undefined): boolean {
  return getUltraEligibilityReason(model) === "eligible"
}

export function resolveUltraSelection(input: {
  reasoningEffort?: unknown
  model?: CodexModelInfo
  childTask?: boolean
}): UltraResolution {
  const logicalEffort = normalize(input.reasoningEffort)
  const selected = logicalEffort === ULTRA_REASONING_EFFORT
  const reason = selected ? getUltraEligibilityReason(input.model) : "missing_catalog"
  const eligible = selected && reason === "eligible"

  return {
    selected,
    logicalEffort,
    wireEffort: selected ? ULTRA_WIRE_REASONING_EFFORT : logicalEffort,
    eligible,
    delegationPolicy: eligible && !input.childTask ? "proactive" : "explicit_request_only",
    reason,
    ...(input.model?.slug ? { modelSlug: input.model.slug } : {}),
    ...(input.model?.multi_agent_version ? { multiAgentVersion: input.model.multi_agent_version } : {})
  }
}

export function normalizeUltraWireEffort(value: unknown): { value: string | undefined; changed: boolean } {
  const normalized = normalize(value)
  if (!normalized) return { value: undefined, changed: false }
  if (normalized !== ULTRA_REASONING_EFFORT) return { value: value as string, changed: false }
  return { value: ULTRA_WIRE_REASONING_EFFORT, changed: true }
}

function isDelegationPolicy(value: unknown): value is UltraDelegationPolicy {
  return value === "proactive" || value === "explicit_request_only"
}

function isEligibilityReason(value: unknown): value is UltraEligibilityReason {
  return typeof value === "string" && ULTRA_ELIGIBILITY_REASONS.has(value as UltraEligibilityReason)
}

function optionalStateString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  return value.trim() || undefined
}

export function parseUltraState(value: string | null | undefined): UltraResolution | undefined {
  if (!value?.trim()) return undefined
  try {
    const parsed = JSON.parse(value) as Partial<UltraResolution>
    if (parsed.selected !== true || parsed.logicalEffort !== ULTRA_REASONING_EFFORT) return undefined
    if (parsed.wireEffort !== ULTRA_WIRE_REASONING_EFFORT) return undefined
    if (typeof parsed.eligible !== "boolean") return undefined
    if (!isDelegationPolicy(parsed.delegationPolicy)) return undefined
    if (!isEligibilityReason(parsed.reason)) return undefined
    if (parsed.eligible !== (parsed.reason === "eligible")) return undefined
    if (parsed.delegationPolicy === "proactive" && !parsed.eligible) return undefined

    const result: UltraResolution = {
      selected: true,
      logicalEffort: ULTRA_REASONING_EFFORT,
      wireEffort: ULTRA_WIRE_REASONING_EFFORT,
      eligible: parsed.eligible,
      delegationPolicy: parsed.delegationPolicy,
      reason: parsed.reason
    }
    const modelSlug = optionalStateString(parsed.modelSlug)
    const multiAgentVersion = optionalStateString(parsed.multiAgentVersion)
    if (modelSlug) result.modelSlug = modelSlug
    if (multiAgentVersion) result.multiAgentVersion = multiAgentVersion
    return result
  } catch {
    return undefined
  }
}

export function retainUltraState(
  current: UltraResolution | undefined,
  encoded: string | null | undefined
): UltraResolution | undefined {
  return parseUltraState(encoded) ?? current
}
