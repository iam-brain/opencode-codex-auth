import os from "node:os"
import path from "node:path"

export function defaultAuthPath(): string {
  return path.join(os.homedir(), ".config", "opencode", "auth.json")
}

export function defaultSnapshotsPath(): string {
  return path.join(os.homedir(), ".config", "opencode", "codex-snapshots.json")
}
