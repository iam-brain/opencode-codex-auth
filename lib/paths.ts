import os from "node:os"
import path from "node:path"

export const CODEX_ACCOUNTS_FILE = "codex-accounts.json"
export const LEGACY_OPENAI_CODEX_ACCOUNTS_FILE = "openai-codex-accounts.json"
export const CODEX_SESSION_AFFINITY_FILE = "codex-session-affinity.json"
export const CODEX_SNAPSHOTS_FILE = "codex-snapshots.json"
const OPENCODE_AUTH_FILE = "auth.json"
const OPENCODE_SESSION_STORAGE_DIR = path.join("opencode", "storage", "session")

export function defaultAuthPath(): string {
  return path.join(defaultOpencodeConfigPath(), CODEX_ACCOUNTS_FILE)
}

export function opencodeProviderAuthPath(): string {
  return path.join(os.homedir(), ".local", "share", "opencode", OPENCODE_AUTH_FILE)
}

export function defaultOpencodeDataPath(env: Record<string, string | undefined> = process.env): string {
  const xdgData = env.XDG_DATA_HOME?.trim()
  if (xdgData) return xdgData
  return path.join(os.homedir(), ".local", "share")
}

export function defaultOpencodeConfigPath(env: Record<string, string | undefined> = process.env): string {
  const xdgConfig = env.XDG_CONFIG_HOME?.trim()
  if (xdgConfig) return path.join(xdgConfig, "opencode")
  return path.join(os.homedir(), ".config", "opencode")
}

export function defaultOpencodeCachePath(env: Record<string, string | undefined> = process.env): string {
  return path.join(defaultOpencodeConfigPath(env), "cache")
}

export function defaultOpencodeSessionStoragePath(env: Record<string, string | undefined> = process.env): string {
  return path.join(defaultOpencodeDataPath(env), OPENCODE_SESSION_STORAGE_DIR)
}

export function opencodeSessionFilePath(
  sessionKey: string,
  env: Record<string, string | undefined> = process.env
): string {
  return path.join(defaultOpencodeSessionStoragePath(env), `${sessionKey}.json`)
}

export function legacyOpenAICodexAccountsPathFor(filePath: string): string {
  return path.join(path.dirname(filePath), LEGACY_OPENAI_CODEX_ACCOUNTS_FILE)
}

export function defaultSnapshotsPath(): string {
  return path.join(defaultOpencodeCachePath(), CODEX_SNAPSHOTS_FILE)
}

export function defaultSessionAffinityPath(
  _authPath: string = defaultAuthPath(),
  env: Record<string, string | undefined> = process.env
): string {
  return path.join(defaultOpencodeCachePath(env), CODEX_SESSION_AFFINITY_FILE)
}
