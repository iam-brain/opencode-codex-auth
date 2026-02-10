import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const PERSONALITY_DIR = "Personalities"
const PERSONALITY_CACHE_MARKER = "<!-- opencode personality cache -->"

function isSafePersonalityKey(value: string): boolean {
  return !value.includes("/") && !value.includes("\\") && !value.includes("..")
}

function normalizePersonalityKey(value: string): string | undefined {
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
    const cleaned = raw.startsWith(PERSONALITY_CACHE_MARKER)
      ? raw.slice(PERSONALITY_CACHE_MARKER.length).trimStart()
      : raw
    const trimmed = cleaned.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

function defaultConfigRoot(): string {
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

  const localFile = resolvePersonalityFile(
    path.join(projectRoot, ".opencode", PERSONALITY_DIR),
    normalized
  )
  if (localFile) {
    const local = readPersonality(localFile)
    if (local) return local
  }

  const globalFile = resolvePersonalityFile(
    path.join(configRoot, PERSONALITY_DIR),
    normalized
  )
  if (globalFile) {
    const global = readPersonality(globalFile)
    if (global) return global
  }

  return null
}
