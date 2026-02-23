import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

type Snapshot = {
  HOME: string | undefined
  XDG_CONFIG_HOME: string | undefined
  XDG_DATA_HOME: string | undefined
  XDG_CACHE_HOME: string | undefined
  XDG_STATE_HOME: string | undefined
  TMPDIR: string | undefined
  TMP: string | undefined
  TEMP: string | undefined
}

let snapshot: Snapshot | undefined

function captureSnapshot(): Snapshot {
  return {
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    TMPDIR: process.env.TMPDIR,
    TMP: process.env.TMP,
    TEMP: process.env.TEMP
  }
}

function restoreValue(key: keyof Snapshot, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

export async function setupIsolatedTestEnv(): Promise<void> {
  if (!snapshot) {
    snapshot = captureSnapshot()
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-test-env-"))
  const home = path.join(root, "home")
  const tmp = path.join(root, "tmp")

  await Promise.all([fs.mkdir(home, { recursive: true }), fs.mkdir(tmp, { recursive: true })])

  process.env.HOME = home
  delete process.env.XDG_CONFIG_HOME
  delete process.env.XDG_DATA_HOME
  delete process.env.XDG_CACHE_HOME
  delete process.env.XDG_STATE_HOME
  process.env.TMPDIR = tmp
  process.env.TMP = tmp
  process.env.TEMP = tmp
}

export function teardownIsolatedTestEnv(): void {
  if (!snapshot) return
  restoreValue("HOME", snapshot.HOME)
  restoreValue("XDG_CONFIG_HOME", snapshot.XDG_CONFIG_HOME)
  restoreValue("XDG_DATA_HOME", snapshot.XDG_DATA_HOME)
  restoreValue("XDG_CACHE_HOME", snapshot.XDG_CACHE_HOME)
  restoreValue("XDG_STATE_HOME", snapshot.XDG_STATE_HOME)
  restoreValue("TMPDIR", snapshot.TMPDIR)
  restoreValue("TMP", snapshot.TMP)
  restoreValue("TEMP", snapshot.TEMP)
}
