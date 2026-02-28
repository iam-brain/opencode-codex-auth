import type { CodexSpoofMode } from "../config.js"

export type CodexOriginator = "opencode" | "codex_cli_rs" | "codex_exec"

function isTuiWorkerInvocation(argv: string[]): boolean {
  return argv.some((entry) => /(?:^|[\\/])tui[\\/]worker\.(?:js|ts)$/i.test(entry))
}

function isRunInvocation(argv: string[]): boolean {
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === "--") break
    if (token === "run") return true
    if (!token.startsWith("-")) {
      const previous = argv[index - 1]
      if (typeof previous === "string" && previous.startsWith("-") && !previous.includes("=")) {
        continue
      }
      return false
    }
  }
  return false
}

export function resolveCodexOriginator(spoofMode: CodexSpoofMode, argv = process.argv): CodexOriginator {
  if (spoofMode !== "codex") return "opencode"
  const normalizedArgv = argv.map((entry) => String(entry))
  if (isTuiWorkerInvocation(normalizedArgv)) return "codex_cli_rs"
  return isRunInvocation(normalizedArgv) ? "codex_exec" : "codex_cli_rs"
}
