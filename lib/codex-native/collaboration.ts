export type CodexCollaborationModeKind = "plan" | "code"

export type CodexCollaborationProfile = {
  enabled: boolean
  kind?: CodexCollaborationModeKind
  normalizedAgentName?: string
  isOrchestrator?: boolean
  instructionPreset?: "plan"
}

export type CollaborationInstructionsByKind = {
  plan: string
  code: string
}

export const CODEX_PLAN_MODE_INSTRUCTIONS_FALLBACK = `# Plan Mode

You are in planning mode.

Focus on clarifying requirements and producing a concrete, decision-complete implementation plan.

Use concise sections that cover:
- scope and goals
- implementation steps
- edge cases and failure handling
- tests and acceptance criteria

Do not claim changes were implemented unless execution mode is explicitly enabled.`

let codexPlanModeInstructions = CODEX_PLAN_MODE_INSTRUCTIONS_FALLBACK

export function getCodexPlanModeInstructions(): string {
  return codexPlanModeInstructions
}

export function setCodexPlanModeInstructions(next: string | undefined): void {
  const trimmed = next?.trim()
  const source = trimmed ? trimmed : CODEX_PLAN_MODE_INSTRUCTIONS_FALLBACK
  codexPlanModeInstructions = replaceCodexToolCallsForOpenCode(source) ?? source
}

export const CODEX_CODE_MODE_INSTRUCTIONS = "you are now in code mode."

export const CODEX_ORCHESTRATOR_INSTRUCTIONS = `# Sub-agents

If subagent tools are unavailable, proceed solo and ignore subagent-specific guidance.

When subagents are available, delegate independent work in parallel, coordinate them with wait/send_input-style flow, and synthesize results before finalizing.

When subagents are active, your primary role is coordination and synthesis; avoid doing worker implementation in parallel with active workers unless needed for unblock/fallback.`

const CODEX_TOOL_NAME_REGEX =
  /\b(exec_command|read_file|search_files|list_dir|write_stdin|spawn_agent|send_input|close_agent|edit_file|apply_patch)\b/i

const TOOL_CALL_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bexec_command\b/gi, replacement: "bash" },
  { pattern: /\bread_file\b/gi, replacement: "read" },
  { pattern: /\bsearch_files\b/gi, replacement: "grep" },
  { pattern: /\blist_dir\b/gi, replacement: "glob" },
  { pattern: /\bwrite_stdin\b/gi, replacement: "task" },
  { pattern: /\bspawn_agent\b/gi, replacement: "task" },
  { pattern: /\bsend_input\b/gi, replacement: "task" },
  { pattern: /\bclose_agent\b/gi, replacement: "skip_task_reuse" },
  { pattern: /\bedit_file\b/gi, replacement: "apply_patch" }
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function resolveHookAgentName(agent: unknown): string | undefined {
  const direct = asString(agent)
  if (direct) return direct
  if (!isRecord(agent)) return undefined
  return asString(agent.name) ?? asString(agent.agent)
}

function normalizeAgentName(agentName: string): string {
  return agentName.trim().toLowerCase().replace(/\s+/g, "-")
}

function tokenizeAgentName(normalizedAgentName: string): string[] {
  return normalizedAgentName
    .split(/[-./:_]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

function isCodexFamily(tokens: string[]): boolean {
  return tokens[0] === "codex"
}

function isPlanPrimary(tokens: string[]): boolean {
  return tokens.length === 1 && tokens[0] === "plan"
}

function isOrchestratorPrimary(tokens: string[]): boolean {
  return tokens.length === 1 && tokens[0] === "orchestrator"
}

export function resolveCollaborationProfile(agent: unknown): CodexCollaborationProfile {
  const name = resolveHookAgentName(agent)
  if (!name) return { enabled: false }

  const normalizedAgentName = normalizeAgentName(name)
  const tokens = tokenizeAgentName(normalizedAgentName)
  if (tokens.length === 0) return { enabled: false, normalizedAgentName }

  const codexFamily = isCodexFamily(tokens)
  const hasPlanToken = tokens.includes("plan") || tokens.includes("planner")
  const hasOrchestratorToken = tokens.includes("orchestrator")

  if ((isPlanPrimary(tokens) || (codexFamily && hasPlanToken)) && !hasOrchestratorToken) {
    return {
      enabled: true,
      normalizedAgentName,
      kind: "plan",
      isOrchestrator: false,
      instructionPreset: "plan"
    }
  }

  if (isOrchestratorPrimary(tokens) || (codexFamily && hasOrchestratorToken)) {
    return {
      enabled: true,
      normalizedAgentName,
      kind: "code",
      isOrchestrator: true
    }
  }

  if (
    codexFamily &&
    tokens.some((token) =>
      ["default", "code", "review", "compact", "compaction", "execute", "pair", "pairprogramming"].includes(token)
    )
  ) {
    return {
      enabled: true,
      normalizedAgentName,
      kind: "code",
      isOrchestrator: false
    }
  }

  return { enabled: false, normalizedAgentName }
}

export function resolveCollaborationInstructions(
  kind: CodexCollaborationModeKind,
  instructions: CollaborationInstructionsByKind
): string {
  if (kind === "plan") return instructions.plan
  return instructions.code
}

export function hasCodexToolNameMarkers(instructions: string | undefined): boolean {
  if (!instructions) return false
  return CODEX_TOOL_NAME_REGEX.test(instructions)
}

export function replaceCodexToolCallsForOpenCode(instructions: string | undefined): string | undefined {
  const normalized = instructions?.trim()
  if (!normalized) return instructions
  if (!hasCodexToolNameMarkers(normalized)) return instructions

  let out = normalized
  for (const replacement of TOOL_CALL_REPLACEMENTS) {
    out = out.replace(replacement.pattern, replacement.replacement)
  }
  return out
}

export function mergeInstructions(base: string | undefined, extra: string): string {
  const normalizedExtra = extra.trim()
  if (!normalizedExtra) return base?.trim() ?? ""
  const normalizedBase = base?.trim()
  if (!normalizedBase) return normalizedExtra
  if (normalizedBase.includes(normalizedExtra)) return normalizedBase
  return `${normalizedBase}\n\n${normalizedExtra}`
}

export function isOrchestratorInstructions(instructions: string | undefined): boolean {
  if (!instructions) return false
  const normalized = instructions.trim()
  if (!normalized) return false
  if (normalized.includes("description: Codex-style orchestration profile for parallel delegation and synthesis.")) {
    return true
  }
  if (!normalized.includes("# Sub-agents")) return false

  const lower = normalized.toLowerCase()
  if (/\bspawn_agent\b/.test(lower)) return true

  const legacyMarkers = [
    "you are codex, a coding agent based on gpt-5.",
    "you and the user share the same workspace and collaborate to achieve the user's goals."
  ]
  if (legacyMarkers.some((marker) => lower.includes(marker))) return true

  const strongMarkers = [
    "if subagent tools are unavailable, proceed solo and ignore subagent-specific guidance.",
    "when subagents are available, delegate independent work in parallel, coordinate them with wait/send_input-style flow, and synthesize results before finalizing.",
    "when subagents are active, your primary role is coordination and synthesis; avoid doing worker implementation in parallel with active workers unless needed for unblock/fallback.",
    "coordinate them via wait / send_input",
    "sub-agents are their to make you go fast",
    "ask the user before shutting sub-agents down unless you need to because you reached the agent limit"
  ]
  if (strongMarkers.some((marker) => lower.includes(marker))) return true

  return (
    lower.includes("delegate independent work in parallel") &&
    (lower.includes("wait/send_input-style flow") || lower.includes("wait / send_input")) &&
    lower.includes("synthesize")
  )
}

export function resolveSubagentHeaderValue(agent: unknown): string | undefined {
  const profile = resolveCollaborationProfile(agent)
  const normalized = profile.normalizedAgentName
  if (!profile.enabled || !normalized) {
    return undefined
  }

  const tokens = tokenizeAgentName(normalized)
  const isPrimary =
    isPlanPrimary(tokens) ||
    isOrchestratorPrimary(tokens) ||
    (tokens[0] === "codex" &&
      (tokens.includes("orchestrator") ||
        tokens.includes("default") ||
        tokens.includes("code") ||
        tokens.includes("plan") ||
        tokens.includes("planner") ||
        tokens.includes("execute") ||
        tokens.includes("pair") ||
        tokens.includes("pairprogramming")))

  if (isPrimary) return undefined
  if (tokens.includes("review")) return "review"
  if (tokens.includes("compact") || tokens.includes("compaction") || normalized === "compaction") {
    return "compact"
  }
  return "collab_spawn"
}
