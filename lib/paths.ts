import os from "node:os"
import path from "node:path"

export const CODEX_ACCOUNTS_FILE = "codex-accounts.json"
export const LEGACY_OPENAI_CODEX_ACCOUNTS_FILE = "openai-codex-accounts.json"
export const CODEX_SESSION_AFFINITY_FILE = "codex-session-affinity.json"
export const CODEX_SNAPSHOTS_FILE = "codex-snapshots.json"
const OPENCODE_AUTH_FILE = "auth.json"
const OPENCODE_SESSION_STORAGE_DIR = path.join("opencode", "storage", "session")

function readAbsoluteEnvPath(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim()
  if (!trimmed) return undefined
  return path.isAbsolute(trimmed) ? trimmed : undefined
}

export function defaultAuthPath(): string {
  return path.join(defaultOpencodeConfigPath(), CODEX_ACCOUNTS_FILE)
}

export function opencodeProviderAuthPath(env: Record<string, string | undefined> = process.env): string {
  return path.join(defaultOpencodeDataPath(env), "opencode", OPENCODE_AUTH_FILE)
}

export function opencodeProviderAuthLegacyFallbackPath(env: Record<string, string | undefined> = process.env): string {
  return opencodeProviderAuthPath({ ...env, XDG_DATA_HOME: undefined })
}

export function defaultOpencodeDataPath(env: Record<string, string | undefined> = process.env): string {
  const xdgData = readAbsoluteEnvPath(env.XDG_DATA_HOME)
  if (xdgData) return xdgData
  return path.join(os.homedir(), ".local", "share")
}

export function defaultOpencodeConfigPath(env: Record<string, string | undefined> = process.env): string {
  const xdgConfig = readAbsoluteEnvPath(env.XDG_CONFIG_HOME)
  if (xdgConfig) return path.join(xdgConfig, "opencode")
  return path.join(os.homedir(), ".config", "opencode")
}

export function defaultOpencodeCachePath(env: Record<string, string | undefined> = process.env): string {
  return path.join(defaultOpencodeConfigPath(env), "cache")
}

export function defaultOpencodeLogsPath(env: Record<string, string | undefined> = process.env): string {
  return path.join(defaultOpencodeConfigPath(env), "logs")
}

export function defaultCodexPluginLogsPath(env: Record<string, string | undefined> = process.env): string {
  return path.join(defaultOpencodeLogsPath(env), "codex-plugin")
}

export function defaultOpencodeSessionStoragePath(env: Record<string, string | undefined> = process.env): string {
  return path.join(defaultOpencodeDataPath(env), OPENCODE_SESSION_STORAGE_DIR)
}

export function opencodeSessionFilePath(
  sessionKey: string,
  env: Record<string, string | undefined> = process.env
): string {
  const baseDir = path.resolve(defaultOpencodeSessionStoragePath(env))
  const normalized = sessionKey.trim()
  if (!normalized) {
    throw new Error("invalid_session_key")
  }
  if (
    path.isAbsolute(normalized) ||
    normalized.includes("..") ||
    normalized.includes("/") ||
    normalized.includes("\\")
  ) {
    throw new Error("invalid_session_key")
  }
  const candidate = path.resolve(baseDir, `${normalized}.json`)
  if (candidate !== baseDir && !candidate.startsWith(`${baseDir}${path.sep}`)) {
    throw new Error("invalid_session_key")
  }
  return candidate
}

export function legacyOpenAICodexAccountsPathFor(filePath: string): string {
  return path.join(path.dirname(filePath), LEGACY_OPENAI_CODEX_ACCOUNTS_FILE)
}

export function defaultSnapshotsPath(): string {
  return path.join(defaultOpencodeCachePath(), CODEX_SNAPSHOTS_FILE)
}

export function defaultSessionAffinityPath(env: Record<string, string | undefined> = process.env): string {
  return path.join(defaultOpencodeCachePath(env), CODEX_SESSION_AFFINITY_FILE)
}
