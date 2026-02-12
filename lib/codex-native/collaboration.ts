export type CodexCollaborationModeKind = "plan" | "code" | "execute" | "pair_programming"

export type CodexCollaborationProfile = {
  enabled: boolean
  kind?: CodexCollaborationModeKind
  normalizedAgentName?: string
}

export type CollaborationInstructionsByKind = {
  plan: string
  code: string
  execute: string
  pairProgramming: string
}

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

function normalizeAgentNameForCollaboration(agentName: string): string {
  return agentName.trim().toLowerCase().replace(/\s+/g, "-")
}

function tokenizeAgentName(normalizedAgentName: string): string[] {
  return normalizedAgentName
    .split(/[-./:_]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

function isPluginCollaborationAgent(normalizedAgentName: string): boolean {
  const tokens = tokenizeAgentName(normalizedAgentName)
  if (tokens.length === 0) return false
  if (tokens[0] !== "codex") return false
  return tokens.some((token) =>
    [
      "orchestrator",
      "default",
      "code",
      "plan",
      "planner",
      "execute",
      "pair",
      "pairprogramming",
      "review",
      "compact",
      "compaction"
    ].includes(token)
  )
}

function resolveCollaborationModeKindFromName(normalizedAgentName: string): CodexCollaborationModeKind {
  const tokens = tokenizeAgentName(normalizedAgentName)
  if (tokens.includes("plan") || tokens.includes("planner")) return "plan"
  if (tokens.includes("execute")) return "execute"
  if (tokens.includes("pair") || tokens.includes("pairprogramming")) return "pair_programming"
  return "code"
}

export function resolveCollaborationProfile(agent: unknown): CodexCollaborationProfile {
  const name = resolveHookAgentName(agent)
  if (!name) return { enabled: false }
  const normalizedAgentName = normalizeAgentNameForCollaboration(name)
  if (!isPluginCollaborationAgent(normalizedAgentName)) {
    return { enabled: false, normalizedAgentName }
  }
  return {
    enabled: true,
    normalizedAgentName,
    kind: resolveCollaborationModeKindFromName(normalizedAgentName)
  }
}

export function resolveCollaborationModeKind(agent: unknown): CodexCollaborationModeKind {
  const profile = resolveCollaborationProfile(agent)
  return profile.kind ?? "code"
}

export function resolveCollaborationInstructions(
  kind: CodexCollaborationModeKind,
  instructions: CollaborationInstructionsByKind
): string {
  if (kind === "plan") return instructions.plan
  if (kind === "execute") return instructions.execute
  if (kind === "pair_programming") return instructions.pairProgramming
  return instructions.code
}

export function mergeInstructions(base: string | undefined, extra: string): string {
  const normalizedExtra = extra.trim()
  if (!normalizedExtra) return base?.trim() ?? ""
  const normalizedBase = base?.trim()
  if (!normalizedBase) return normalizedExtra
  if (normalizedBase.includes(normalizedExtra)) return normalizedBase
  return `${normalizedBase}\n\n${normalizedExtra}`
}

export function resolveSubagentHeaderValue(agent: unknown): string | undefined {
  const profile = resolveCollaborationProfile(agent)
  const normalized = profile.normalizedAgentName
  if (!profile.enabled || !normalized) {
    return undefined
  }
  const tokens = tokenizeAgentName(normalized)
  const isCodexPrimary =
    tokens[0] === "codex" &&
    (tokens.includes("orchestrator") ||
      tokens.includes("default") ||
      tokens.includes("code") ||
      tokens.includes("plan") ||
      tokens.includes("planner") ||
      tokens.includes("execute") ||
      tokens.includes("pair") ||
      tokens.includes("pairprogramming"))
  if (isCodexPrimary) {
    return undefined
  }
  if (tokens.includes("plan") || tokens.includes("planner")) {
    return undefined
  }
  if (normalized === "compaction") {
    return "compact"
  }
  if (normalized.includes("review")) return "review"
  if (normalized.includes("compact") || normalized.includes("compaction")) return "compact"
  return "collab_spawn"
}
