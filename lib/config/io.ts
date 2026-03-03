import fs from "node:fs"
import fsPromises from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { CONFIG_FILE, DEFAULT_CODEX_CONFIG_TEMPLATE, type PluginConfig } from "./types.js"
import { parseConfigFileObject, parseConfigJsonWithComments } from "./parse.js"
import { validateConfigFileObject } from "./validation.js"

export function resolveDefaultConfigPath(env: Record<string, string | undefined>): string {
  const xdgRoot = env.XDG_CONFIG_HOME?.trim()
  if (xdgRoot) {
    return path.join(xdgRoot, "opencode", CONFIG_FILE)
  }
  return path.join(os.homedir(), ".config", "opencode", CONFIG_FILE)
}

export type EnsureDefaultConfigFileResult = {
  filePath: string
  created: boolean
}

export async function ensureDefaultConfigFile(
  input: { env?: Record<string, string | undefined>; filePath?: string; overwrite?: boolean } = {}
): Promise<EnsureDefaultConfigFileResult> {
  const env = input.env ?? process.env
  const filePath = input.filePath ?? resolveDefaultConfigPath(env)
  const overwrite = input.overwrite === true

  if (!overwrite && fs.existsSync(filePath)) {
    return { filePath, created: false }
  }

  await fsPromises.mkdir(path.dirname(filePath), { recursive: true })
  const content = DEFAULT_CODEX_CONFIG_TEMPLATE
  await fsPromises.writeFile(filePath, content, { encoding: "utf8", mode: 0o600 })
  try {
    await fsPromises.chmod(filePath, 0o600)
  } catch (error) {
    if (error instanceof Error) {
      // best-effort permission hardening
    }
  }
  return { filePath, created: true }
}

export function loadConfigFile(
  input: { env?: Record<string, string | undefined>; filePath?: string } = {}
): Partial<PluginConfig> {
  const env = input.env ?? process.env
  const explicitPath = input.filePath ?? env.OPENCODE_OPENAI_MULTI_CONFIG_PATH?.trim()

  const candidates = explicitPath ? [explicitPath] : [resolveDefaultConfigPath(env)]

  for (const filePath of candidates) {
    if (!filePath) continue
    if (!fs.existsSync(filePath)) continue
    try {
      const raw = fs.readFileSync(filePath, "utf8")
      const parsed = parseConfigJsonWithComments(raw)
      const validation = validateConfigFileObject(parsed)
      if (!validation.valid) {
        const message = `[opencode-codex-auth] Invalid codex-config at ${filePath}. ${validation.issues.join("; ")}`
        console.warn(message)
        continue
      }
      return parseConfigFileObject(parsed)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const message = `[opencode-codex-auth] Failed to read codex-config at ${filePath}. ${detail}`
      console.warn(message)
      continue
    }
  }

  return {}
}
