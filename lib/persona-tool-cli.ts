import fs from "node:fs/promises"
import path from "node:path"

import { generatePersonaSpec, type PersonaDomain, type PersonaTargetStyle } from "./persona-tool"

type CliIo = {
  out: (message: string) => void
  err: (message: string) => void
}

const DEFAULT_IO: CliIo = {
  out: (message) => process.stdout.write(`${message}\n`),
  err: (message) => process.stderr.write(`${message}\n`)
}

type ParsedArgs = {
  inputPath?: string
  style: PersonaTargetStyle
  outPath?: string
  jsonPath?: string
  domain: PersonaDomain
  voiceFidelity: number
  competenceStrictness: number
  includeVariants: boolean
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseStyle(value: string | undefined): PersonaTargetStyle | undefined {
  if (!value) return undefined
  if (value === "lean" || value === "mid" || value === "friendly-sized") return value
  return undefined
}

function parseDomain(value: string | undefined): PersonaDomain | undefined {
  if (!value) return undefined
  if (value === "coding" || value === "audit" || value === "research" || value === "general") return value
  return undefined
}

function helpText(): string {
  return [
    "persona-tool",
    "",
    "Usage:",
    "  persona-tool --in voice.md --style friendly-sized --domain coding --out agent.md --json out.json",
    "",
    "Options:",
    "  --in <path>                   Source personality/voice markdown file (required).",
    "  --style <lean|mid|friendly-sized>",
    "  --domain <coding|audit|research|general>",
    "  --voice-fidelity <0..1>",
    "  --competence-strictness <0..1>",
    "  --out <path>                  Output markdown path (optional; stdout when omitted).",
    "  --json <path>                 Output JSON path (optional).",
    "  --no-variants                 Omit lean/mid/friendly-sized variants from JSON.",
    "  -h, --help                    Show this help."
  ].join("\n")
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    style: "mid",
    domain: "general",
    voiceFidelity: 0.85,
    competenceStrictness: 0.95,
    includeVariants: true
  }

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]
    const next = args[index + 1]

    if (token === "--in") parsed.inputPath = next
    else if (token.startsWith("--in=")) parsed.inputPath = token.slice("--in=".length)
    else if (token === "--style") parsed.style = parseStyle(next) ?? parsed.style
    else if (token.startsWith("--style=")) parsed.style = parseStyle(token.slice("--style=".length)) ?? parsed.style
    else if (token === "--domain") parsed.domain = parseDomain(next) ?? parsed.domain
    else if (token.startsWith("--domain=")) parsed.domain = parseDomain(token.slice("--domain=".length)) ?? parsed.domain
    else if (token === "--voice-fidelity") parsed.voiceFidelity = parseNumber(next, parsed.voiceFidelity)
    else if (token.startsWith("--voice-fidelity=")) {
      parsed.voiceFidelity = parseNumber(token.slice("--voice-fidelity=".length), parsed.voiceFidelity)
    } else if (token === "--competence-strictness") {
      parsed.competenceStrictness = parseNumber(next, parsed.competenceStrictness)
    } else if (token.startsWith("--competence-strictness=")) {
      parsed.competenceStrictness = parseNumber(
        token.slice("--competence-strictness=".length),
        parsed.competenceStrictness
      )
    } else if (token === "--out") parsed.outPath = next
    else if (token.startsWith("--out=")) parsed.outPath = token.slice("--out=".length)
    else if (token === "--json") parsed.jsonPath = next
    else if (token.startsWith("--json=")) parsed.jsonPath = token.slice("--json=".length)
    else if (token === "--no-variants") parsed.includeVariants = false

    if (
      token === "--in" ||
      token === "--style" ||
      token === "--domain" ||
      token === "--voice-fidelity" ||
      token === "--competence-strictness" ||
      token === "--out" ||
      token === "--json"
    ) {
      index += 1
    }
  }

  return parsed
}

export async function runPersonaToolCli(args: string[], io: CliIo = DEFAULT_IO): Promise<number> {
  if (args.includes("--help") || args.includes("-h")) {
    io.out(helpText())
    return 0
  }

  const parsed = parseArgs(args)
  if (!parsed.inputPath) {
    io.err("Missing required --in <path> argument.")
    io.err(helpText())
    return 1
  }

  const inputPath = path.resolve(parsed.inputPath)
  let sourceText = ""
  try {
    sourceText = await fs.readFile(inputPath, "utf8")
  } catch {
    io.err(`Unable to read input file: ${inputPath}`)
    return 1
  }

  const result = generatePersonaSpec({
    source_text: sourceText,
    target_style: parsed.style,
    voice_fidelity: parsed.voiceFidelity,
    competence_strictness: parsed.competenceStrictness,
    domain: parsed.domain,
    include_variants: parsed.includeVariants
  })

  if (parsed.outPath) {
    const outputPath = path.resolve(parsed.outPath)
    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    await fs.writeFile(outputPath, result.agent_markdown, { encoding: "utf8", mode: 0o600 })
  } else {
    io.out(result.agent_markdown.trimEnd())
  }

  if (parsed.jsonPath) {
    const jsonPath = path.resolve(parsed.jsonPath)
    await fs.mkdir(path.dirname(jsonPath), { recursive: true })
    await fs.writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    })
  }

  io.out(`Token estimate: ${result.token_estimate}`)
  io.out(`Voice traits: ${result.voice_signature.length}`)
  io.out(`Protocol rules: ${result.protocol_rules.length}`)
  return 0
}
