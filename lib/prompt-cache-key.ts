import { createHash } from "node:crypto"

import type { CodexSpoofMode } from "./config.js"

export const PROMPT_CACHE_KEY_VERSION = 1
const PROMPT_CACHE_KEY_PREFIX = "ocpk"

function normalizeProjectPath(projectPath: string): string {
  const trimmed = projectPath.trim()
  if (!trimmed) return "project:unknown"
  const slashNormalized = trimmed.replaceAll("\\", "/")
  return slashNormalized
}

export function buildProjectPromptCacheKey(input: { projectPath: string; spoofMode: CodexSpoofMode }): string {
  const normalizedPath = normalizeProjectPath(input.projectPath)
  const source = `v${PROMPT_CACHE_KEY_VERSION}|project|${input.spoofMode}|${normalizedPath}`
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 24)
  return `${PROMPT_CACHE_KEY_PREFIX}_v${PROMPT_CACHE_KEY_VERSION}_${digest}`
}
