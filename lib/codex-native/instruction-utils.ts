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
