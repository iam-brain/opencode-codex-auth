import os from "node:os"
import path from "node:path"

export const CODEX_ACCOUNTS_FILE = "codex-accounts.json"
export const LEGACY_OPENAI_CODEX_ACCOUNTS_FILE = "openai-codex-accounts.json"
const OPENCODE_AUTH_FILE = "auth.json"

export function defaultAuthPath(): string {
  return path.join(os.homedir(), ".config", "opencode", CODEX_ACCOUNTS_FILE)
}

export function opencodeProviderAuthPath(): string {
  return path.join(os.homedir(), ".local", "share", "opencode", OPENCODE_AUTH_FILE)
}

export function legacyOpenAICodexAccountsPathFor(filePath: string): string {
  return path.join(path.dirname(filePath), LEGACY_OPENAI_CODEX_ACCOUNTS_FILE)
}

export function defaultSnapshotsPath(): string {
  return path.join(os.homedir(), ".config", "opencode", "codex-snapshots.json")
}
