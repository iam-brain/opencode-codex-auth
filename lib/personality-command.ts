import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export const CREATE_PERSONALITY_COMMAND_FILE = "create-personality.md"
const PRIVATE_DIR_MODE = 0o700

async function ensurePrivateDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true, mode: PRIVATE_DIR_MODE })
  await fs.chmod(dirPath, PRIVATE_DIR_MODE).catch(() => {})
}

const CREATE_PERSONALITY_COMMAND_TEMPLATE = `---
description: Build a custom coding personality and save it with the create-personality tool.
---
You are helping the user define a custom coding personality for OpenCode Codex Auth.

Reference style:
- friendly: collaborative, warm, clear, supportive.
- pragmatic: direct, concise, implementation-focused, low-fluff.

Workflow:
1. Ask focused questions one at a time until you have enough detail:
   - name/key (short, lowercase slug)
   - source personality text (or core excerpts)
   - inspiration source (person, document, character, or style)
   - tone and communication style
   - collaboration preferences while coding
   - coding style preferences
   - hard guardrails and avoidances
   - short example phrases (optional)
2. Keep the personality rooted in coding-assistant behavior:
   - terminal-first coding work
   - safety and correctness
   - clear, actionable communication
3. When ready, call the tool \`create-personality\` with structured fields.
   - Prefer the structured source route:
     - \`name\`, \`sourceText\`, \`targetStyle\`, \`voiceFidelity\`, \`competenceStrictness\`, \`domain\`
   - Then persist file with \`scope\` and \`overwrite\` as needed.
4. Confirm the resulting key + path, then show how to activate:
   - set \`global.personality\` in \`codex-config.json\`
   - or set \`perModel.<model>.personality\`

Initial user context (if any):
$ARGUMENTS
`

export type InstallCreatePersonalityCommandInput = {
  commandsDir?: string
  force?: boolean
}

export type InstallCreatePersonalityCommandResult = {
  commandsDir: string
  filePath: string
  created: boolean
  updated: boolean
}

export function defaultOpencodeCommandsDir(env: Record<string, string | undefined> = process.env): string {
  const xdgRoot = env.XDG_CONFIG_HOME?.trim()
  if (xdgRoot) {
    return path.join(xdgRoot, "opencode", "commands")
  }
  return path.join(os.homedir(), ".config", "opencode", "commands")
}

export async function installCreatePersonalityCommand(
  input: InstallCreatePersonalityCommandInput = {}
): Promise<InstallCreatePersonalityCommandResult> {
  const commandsDir = input.commandsDir ?? defaultOpencodeCommandsDir()
  const filePath = path.join(commandsDir, CREATE_PERSONALITY_COMMAND_FILE)
  let existingContent: string | undefined

  try {
    existingContent = await fs.readFile(filePath, "utf8")
  } catch {
    // continue to write new file
  }

  if (existingContent !== undefined && input.force !== true) {
    return { commandsDir, filePath, created: false, updated: false }
  }

  if (existingContent !== undefined && existingContent === CREATE_PERSONALITY_COMMAND_TEMPLATE) {
    return { commandsDir, filePath, created: false, updated: false }
  }

  await ensurePrivateDir(commandsDir)
  await fs.writeFile(filePath, CREATE_PERSONALITY_COMMAND_TEMPLATE, { encoding: "utf8", mode: 0o600 })
  return {
    commandsDir,
    filePath,
    created: existingContent === undefined,
    updated: existingContent !== undefined
  }
}
