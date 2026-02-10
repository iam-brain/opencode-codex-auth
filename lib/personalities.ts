import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const PERSONALITY_DIRS = ["personalities", "Personalities"] as const

export function isSafePersonalityKey(value: string): boolean {
  return !value.includes("/") && !value.includes("\\") && !value.includes("..")
}

export function normalizePersonalityKey(value: string): string | undefined {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return undefined
  if (!isSafePersonalityKey(normalized)) return undefined
  return normalized
}

function resolvePersonalityFile(directory: string, personality: string): string | undefined {
  try {
    const entries = fs.readdirSync(directory)
    const target = `${personality}.md`
    const matched = entries.find((entry) => entry.toLowerCase() === target)
    if (!matched) return undefined
    return path.join(directory, matched)
  } catch {
    return undefined
  }
}

function readPersonality(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8")
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

export function defaultConfigRoot(): string {
  const xdgRoot = process.env.XDG_CONFIG_HOME?.trim()
  if (xdgRoot) return path.join(xdgRoot, "opencode")
  return path.join(os.homedir(), ".config", "opencode")
}

export function resolveCustomPersonalityDescription(
  personality: string,
  options: {
    projectRoot?: string
    configRoot?: string
  } = {}
): string | null {
  const normalized = normalizePersonalityKey(personality)
  if (!normalized) return null

  const projectRoot = options.projectRoot ?? process.cwd()
  const configRoot = options.configRoot ?? defaultConfigRoot()

  for (const directory of PERSONALITY_DIRS) {
    const localFile = resolvePersonalityFile(
      path.join(projectRoot, ".opencode", directory),
      normalized
    )
    if (localFile) {
      const local = readPersonality(localFile)
      if (local) return local
    }
  }

  for (const directory of PERSONALITY_DIRS) {
    const globalFile = resolvePersonalityFile(
      path.join(configRoot, directory),
      normalized
    )
    if (globalFile) {
      const global = readPersonality(globalFile)
      if (global) return global
    }
  }

  return null
}
