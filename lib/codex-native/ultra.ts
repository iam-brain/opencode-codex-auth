import type { CodexModelInfo } from "../model-catalog.js"
import type { UltraReasoningEffort } from "../config.js"
import type { AgentExecution, AgentExecutionReason, AgentExecutionRole } from "./agent-execution.js"
export { ULTRA_EXPLICIT_ONLY_INSTRUCTIONS, ULTRA_PROACTIVE_INSTRUCTIONS } from "./generated/ultra-instructions.js"
import { ULTRA_EXPLICIT_ONLY_INSTRUCTIONS, ULTRA_PROACTIVE_INSTRUCTIONS } from "./generated/ultra-instructions.js"

const ULTRA_REASONING_EFFORT = "ultra"
const DEFAULT_ULTRA_WIRE_REASONING_EFFORT: UltraReasoningEffort = "max"
const ULTRA_MULTI_AGENT_VERSION = "v2"

export type UltraDelegationPolicy = "proactive" | "explicit_request_only" | "disabled"

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
  agentRole: AgentExecutionRole
  agentReason: AgentExecutionReason
  agentName?: string
  reason: UltraEligibilityReason
  modelSlug?: string
  multiAgentVersion?: string
}

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
  wireReasoningEffort?: UltraReasoningEffort
  model?: CodexModelInfo
  agentExecution?: AgentExecution
  childTask?: boolean
}): UltraResolution {
  const logicalEffort = normalize(input.reasoningEffort)
  const selected = logicalEffort === ULTRA_REASONING_EFFORT
  const reason = selected ? getUltraEligibilityReason(input.model) : "missing_catalog"
  const eligible = selected && reason === "eligible"
  const agentExecution: AgentExecution =
    input.agentExecution ??
    (input.childTask
      ? { role: "child", reason: "conservative_fallback" }
      : { role: "root", reason: "conservative_fallback" })
  const delegationPolicy: UltraDelegationPolicy =
    agentExecution.role === "auxiliary" ? "disabled" : eligible ? "proactive" : "explicit_request_only"

  return {
    selected,
    logicalEffort,
    wireEffort: selected ? (input.wireReasoningEffort ?? DEFAULT_ULTRA_WIRE_REASONING_EFFORT) : logicalEffort,
    eligible,
    delegationPolicy,
    agentRole: agentExecution.role,
    agentReason: agentExecution.reason,
    ...(agentExecution.agentName ? { agentName: agentExecution.agentName } : {}),
    reason,
    ...(input.model?.slug ? { modelSlug: input.model.slug } : {}),
    ...(input.model?.multi_agent_version ? { multiAgentVersion: input.model.multi_agent_version } : {})
  }
}

function isDelegationPolicy(value: unknown): value is UltraDelegationPolicy {
  return value === "proactive" || value === "explicit_request_only" || value === "disabled"
}

function isAgentRole(value: unknown): value is AgentExecutionRole {
  return value === "root" || value === "child" || value === "auxiliary"
}

const AGENT_EXECUTION_REASONS = new Set<AgentExecutionReason>([
  "session_parent",
  "session_root",
  "configured_primary",
  "configured_subagent",
  "builtin_primary",
  "builtin_subagent",
  "builtin_auxiliary",
  "conservative_fallback"
])

function isAgentReason(value: unknown): value is AgentExecutionReason {
  return typeof value === "string" && AGENT_EXECUTION_REASONS.has(value as AgentExecutionReason)
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
    if (
      parsed.wireEffort !== "low" &&
      parsed.wireEffort !== "medium" &&
      parsed.wireEffort !== "high" &&
      parsed.wireEffort !== "xhigh" &&
      parsed.wireEffort !== "max"
    )
      return undefined
    if (typeof parsed.eligible !== "boolean") return undefined
    if (!isDelegationPolicy(parsed.delegationPolicy)) return undefined
    if (!isAgentRole(parsed.agentRole) || !isAgentReason(parsed.agentReason)) return undefined
    if (!isEligibilityReason(parsed.reason)) return undefined
    if (parsed.eligible !== (parsed.reason === "eligible")) return undefined
    if (parsed.delegationPolicy === "proactive" && !parsed.eligible) return undefined
    if (parsed.eligible && parsed.agentRole !== "auxiliary" && parsed.delegationPolicy !== "proactive") return undefined
    if (parsed.delegationPolicy === "disabled" && parsed.agentRole !== "auxiliary") return undefined
    if (parsed.agentRole === "auxiliary" && parsed.delegationPolicy !== "disabled") return undefined

    const result: UltraResolution = {
      selected: true,
      logicalEffort: ULTRA_REASONING_EFFORT,
      wireEffort: parsed.wireEffort,
      eligible: parsed.eligible,
      delegationPolicy: parsed.delegationPolicy,
      agentRole: parsed.agentRole,
      agentReason: parsed.agentReason,
      reason: parsed.reason
    }
    const modelSlug = optionalStateString(parsed.modelSlug)
    const multiAgentVersion = optionalStateString(parsed.multiAgentVersion)
    const agentName = optionalStateString(parsed.agentName)
    if (modelSlug) result.modelSlug = modelSlug
    if (multiAgentVersion) result.multiAgentVersion = multiAgentVersion
    if (agentName) result.agentName = agentName
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

export function stripUltraDelegationInstructions(payload: Record<string, unknown>): boolean {
  if (typeof payload.instructions !== "string") return false

  const current = payload.instructions
  let next = current
  let overlayRemoved = false
  for (const overlay of [ULTRA_PROACTIVE_INSTRUCTIONS, ULTRA_EXPLICIT_ONLY_INSTRUCTIONS]) {
    if (!next.includes(overlay)) continue
    next = next.replaceAll(overlay, "")
    overlayRemoved = true
  }
  if (!overlayRemoved) return false

  next = next.replace(/\n{3,}/g, "\n\n").trim()

  if (next) {
    payload.instructions = next
  } else {
    delete payload.instructions
  }
  return true
}
