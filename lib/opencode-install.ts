import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { quarantineFile } from "./quarantine.js"
import { isFsErrorCode, writeJsonFile } from "./cache-io.js"

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

async function quarantineMalformedConfig(configPath: string): Promise<void> {
  const quarantineDir = path.join(path.dirname(configPath), "quarantine")
  await quarantineFile({
    sourcePath: configPath,
    quarantineDir,
    now: Date.now
  })
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
    try {
      current = JSON.parse(raw) as OpencodeConfigShape
    } catch (error) {
      await quarantineMalformedConfig(configPath)
      created = true
      current = {}
      if (!(error instanceof SyntaxError)) {
        throw error
      }
    }
  } catch (error) {
    if (isFsErrorCode(error, "ENOENT")) {
      created = true
      current = {}
    } else {
      throw error
    }
  }

  const plugins = normalizePluginList(current.plugin)
  if (!plugins.includes(pluginSpecifier)) {
    plugins.push(pluginSpecifier)
    changed = true
  }

  if (created || changed || !Array.isArray(current.plugin)) {
    const next: OpencodeConfigShape = { ...current, plugin: plugins }
    await writeJsonFile(configPath, next)
  }

  return {
    configPath,
    pluginSpecifier,
    created,
    changed,
    plugins
  }
}
