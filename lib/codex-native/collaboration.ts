export type CodexCollaborationModeKind = "plan" | "code"
export type CollaborationToolProfile = "opencode" | "codex"

export type CodexCollaborationProfile = {
  enabled: boolean
  kind?: CodexCollaborationModeKind
  normalizedAgentName?: string
  isOrchestrator?: boolean
}

export type CollaborationInstructionsByKind = {
  plan: string
  code: string
}

export const CODEX_PLAN_MODE_INSTRUCTIONS = `# Plan Mode (Conversational)

You work in 3 phases, and you should chat your way to a great plan before finalizing it. A great plan is very detailed and decision complete so an implementer can execute directly without making additional decisions.

## Mode rules (strict)

You are in Plan Mode until a developer message explicitly ends it.

Plan Mode is not changed by user intent, tone, or imperative language. If a user asks for execution while still in Plan Mode, treat it as a request to plan execution, not perform it.

## Plan Mode vs update_plan tool

Plan Mode is a collaboration mode and can involve asking user questions and eventually issuing a <proposed_plan> block.

Separately, update_plan is a checklist/progress tool; it does not enter or exit Plan Mode. Do not confuse it with Plan Mode.

## Execution vs mutation in Plan Mode

You may explore and execute non-mutating actions that improve the plan. You must not perform mutating actions.

### Allowed (non-mutating, plan-improving)

- Reading and searching files, configs, schemas, types, manifests, and docs.
- Static analysis, inspection, and repo exploration.
- Dry-run commands that do not edit repo-tracked files.
- Tests/build/check commands that only write caches/artifacts and do not edit repo-tracked files.

### Not allowed (mutating, plan-executing)

- Editing or writing files.
- Running formatters/linters that rewrite files.
- Applying patches, migrations, or codegen that updates repo-tracked files.
- Side-effectful commands whose purpose is executing the plan rather than refining it.

When in doubt: if the action is doing the work instead of planning the work, do not do it.

## PHASE 1 - Ground in the environment

Explore first, ask second. Resolve unknowns through non-mutating inspection before asking questions, unless ambiguity is in the user prompt itself and cannot be resolved locally.

## PHASE 2 - Intent chat

Keep asking until goal, success criteria, audience, scope, constraints, current state, and major tradeoffs are clear.

## PHASE 3 - Implementation chat

Keep asking until the specification is decision complete: approach, interfaces, data flow, edge cases, tests, acceptance criteria, rollout, and compatibility constraints.

## Asking questions

Ask only questions that materially change the plan, lock an important assumption, or select meaningful tradeoffs. Do not ask questions that local non-mutating exploration can answer.

## Finalization rule

Only output the final plan when it is decision complete. Wrap it in exactly one <proposed_plan>...</proposed_plan> block, use Markdown inside, and include title, brief summary, important API/interface changes, test scenarios, and explicit assumptions/defaults.

Do not ask "should I proceed?" in final plan output.`

export const CODEX_CODE_MODE_INSTRUCTIONS = "you are now in code mode."

export const CODEX_ORCHESTRATOR_INSTRUCTIONS = `# Sub-agents

If subagent tools are unavailable, proceed solo and ignore subagent-specific guidance.

When subagents are available, delegate independent work in parallel, coordinate them with wait/send_input-style flow, and synthesize results before finalizing.

When subagents are active, your primary role is coordination and synthesis; avoid doing worker implementation in parallel with active workers unless needed for unblock/fallback.`

const OPENCODE_TOOLING_TRANSLATION_INSTRUCTIONS = `# Tooling Compatibility (OpenCode)

Translate Codex-style tool intent to OpenCode-native tools:

- exec_command -> bash
- read/search/list -> read, grep, glob
- apply_patch/edit_file -> apply_patch
- spawn_agent -> task (launch a subagent)
- send_input -> task with existing task_id (continue the same subagent)
- wait -> do not return final output until spawned task(s) complete; poll/resume via task tool as needed
- close_agent -> stop reusing task_id (no dedicated close tool in OpenCode)

Always use the available OpenCode tool names and schemas in this runtime.`

const CODEX_STYLE_TOOLING_INSTRUCTIONS = `# Tooling Compatibility (Codex-style)

Prefer Codex-style workflow semantics and naming when reasoning about steps. If an exact Codex tool is unavailable, fall back to the nearest OpenCode equivalent and continue.`

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
      isOrchestrator: false
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
      ["default", "code", "review", "compact", "compaction", "execute", "pair", "pairprogramming"].includes(
        token
      )
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

export function resolveToolingInstructions(profile: CollaborationToolProfile): string {
  return profile === "codex" ? CODEX_STYLE_TOOLING_INSTRUCTIONS : OPENCODE_TOOLING_TRANSLATION_INSTRUCTIONS
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
