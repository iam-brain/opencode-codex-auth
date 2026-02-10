import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export const DEFAULT_PLUGIN_SPECIFIER = "@iam-brain/opencode-codex-auth@latest"

export function defaultOpencodeConfigPath(env: Record<string, string | undefined> = process.env): string {
  const xdgRoot = env.XDG_CONFIG_HOME?.trim()
  if (xdgRoot) {
    return path.join(xdgRoot, "opencode", "opencode.json")
  }
  return path.join(os.homedir(), ".config", "opencode", "opencode.json")
}

type OpencodeConfigShape = {
  plugin?: unknown
  [key: string]: unknown
}

export type EnsurePluginInstalledInput = {
  configPath?: string
  pluginSpecifier?: string
}

export type EnsurePluginInstalledResult = {
  configPath: string
  pluginSpecifier: string
  created: boolean
  changed: boolean
  plugins: string[]
}

function normalizePluginList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    return [raw]
  }
  return []
}

export async function ensurePluginInstalled(
  input: EnsurePluginInstalledInput = {}
): Promise<EnsurePluginInstalledResult> {
  const configPath = input.configPath ?? defaultOpencodeConfigPath()
  const pluginSpecifier = (input.pluginSpecifier ?? DEFAULT_PLUGIN_SPECIFIER).trim()
  let created = false
  let changed = false

  let current: OpencodeConfigShape = {}
  try {
    const raw = await fs.readFile(configPath, "utf8")
    current = JSON.parse(raw) as OpencodeConfigShape
  } catch {
    created = true
    current = {}
  }

  const plugins = normalizePluginList(current.plugin)
  if (!plugins.includes(pluginSpecifier)) {
    plugins.push(pluginSpecifier)
    changed = true
  }

  if (created || changed || !Array.isArray(current.plugin)) {
    const next: OpencodeConfigShape = { ...current, plugin: plugins }
    await fs.mkdir(path.dirname(configPath), { recursive: true })
    await fs.writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  }

  return {
    configPath,
    pluginSpecifier,
    created,
    changed,
    plugins
  }
}
