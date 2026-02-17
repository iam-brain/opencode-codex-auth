import fs from "node:fs/promises"
import path from "node:path"

import { defaultConfigRoot, normalizePersonalityKey } from "./personalities"
import { isFsErrorCode } from "./cache-io"

export type PersonalityScope = "global" | "project"

export type CreatePersonalityInput = {
  name: string
  scope?: PersonalityScope
  projectRoot?: string
  configRoot?: string
  inspiration?: string
  tone?: string
  collaborationStyle?: string
  codeStyle?: string
  constraints?: string
  examples?: string
  markdown?: string
  overwrite?: boolean
}

export type CreatePersonalityResult = {
  key: string
  filePath: string
  scope: PersonalityScope
  created: boolean
}

const PERSONALITIES_DIR = "personalities"

const CORE_POLICY_LINES = [
  "You are Codex, a coding agent in a terminal-first workflow.",
  "You prioritize correctness, safety, and clear communication.",
  "You never invent command output, tool results, or files you did not inspect.",
  "You make small, reversible changes and validate behavior before claiming success.",
  "You stay collaborative: concise when possible, detailed when needed."
]

function normalizeText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function section(title: string, body: string | undefined): string[] {
  if (!body) return []
  return [`## ${title}`, body, ""]
}

export function renderPersonalityMarkdown(input: {
  key: string
  inspiration?: string
  tone?: string
  collaborationStyle?: string
  codeStyle?: string
  constraints?: string
  examples?: string
}): string {
  const inspiration = normalizeText(input.inspiration)
  const tone = normalizeText(input.tone)
  const collaborationStyle = normalizeText(input.collaborationStyle)
  const codeStyle = normalizeText(input.codeStyle)
  const constraints = normalizeText(input.constraints)
  const examples = normalizeText(input.examples)

  const lines: string[] = [
    `# Personality: ${input.key}`,
    "",
    "## Core Assistant Contract",
    ...CORE_POLICY_LINES.map((line) => `- ${line}`),
    "",
    "This section is required and should remain intact for any derived personality.",
    ""
  ]

  lines.push(...section("Inspiration", inspiration))
  lines.push(...section("Tone", tone))
  lines.push(...section("Collaboration Style", collaborationStyle))
  lines.push(...section("Coding Style", codeStyle))
  lines.push(...section("Guardrails", constraints))
  lines.push(...section("Examples", examples))

  if (lines.at(-1) !== "") lines.push("")
  return lines.join("\n")
}

export function resolvePersonalityFilePath(input: {
  key: string
  scope: PersonalityScope
  projectRoot?: string
  configRoot?: string
}): string {
  const root =
    input.scope === "project"
      ? path.join(input.projectRoot ?? process.cwd(), ".opencode")
      : (input.configRoot ?? defaultConfigRoot())
  return path.join(root, PERSONALITIES_DIR, `${input.key}.md`)
}

export async function createPersonalityFile(input: CreatePersonalityInput): Promise<CreatePersonalityResult> {
  const key = normalizePersonalityKey(input.name)
  if (!key) {
    throw new Error("Invalid personality name. Use a safe key without path characters.")
  }

  const scope: PersonalityScope = input.scope === "project" ? "project" : "global"
  const filePath = resolvePersonalityFilePath({
    key,
    scope,
    projectRoot: input.projectRoot,
    configRoot: input.configRoot
  })

  const content = renderPersonalityMarkdown({
    key,
    inspiration: input.inspiration,
    tone: input.tone,
    collaborationStyle: input.collaborationStyle,
    codeStyle: input.codeStyle,
    constraints: input.constraints,
    examples: input.examples
  })
  const finalContent = input.markdown?.trim() ? `${input.markdown.trim()}\n` : `${content}\n`

  let created = true
  try {
    await fs.stat(filePath)
    if (input.overwrite !== true) {
      return { key, filePath, scope, created: false }
    }
    created = false
  } catch (error) {
    if (!isFsErrorCode(error, "ENOENT")) {
      throw error
    }
    created = true
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, finalContent, { encoding: "utf8", mode: 0o600 })
  return { key, filePath, scope, created }
}
