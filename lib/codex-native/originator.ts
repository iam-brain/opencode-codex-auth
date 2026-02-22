import type { CodexSpoofMode } from "../config.js"

export type CodexOriginator = "opencode" | "codex_cli_rs" | "codex_exec"

function isTuiWorkerInvocation(argv: string[]): boolean {
  return argv.some((entry) => /(?:^|[\\/])tui[\\/]worker\.(?:js|ts)$/i.test(entry))
}

export function resolveCodexOriginator(spoofMode: CodexSpoofMode, argv = process.argv): CodexOriginator {
  if (spoofMode !== "codex") return "opencode"
  const normalizedArgv = argv.map((entry) => String(entry))
  if (isTuiWorkerInvocation(normalizedArgv)) return "codex_cli_rs"
  return normalizedArgv.includes("run") ? "codex_exec" : "codex_cli_rs"
}
