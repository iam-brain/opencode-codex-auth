import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

type Snapshot = {
  HOME: string | undefined
  XDG_CONFIG_HOME: string | undefined
  XDG_DATA_HOME: string | undefined
  XDG_CACHE_HOME: string | undefined
  XDG_STATE_HOME: string | undefined
  USERPROFILE: string | undefined
  HOMEDRIVE: string | undefined
  HOMEPATH: string | undefined
  APPDATA: string | undefined
  LOCALAPPDATA: string | undefined
  TMPDIR: string | undefined
  TMP: string | undefined
  TEMP: string | undefined
}

let snapshot: Snapshot | undefined
const isolatedRoots: string[] = []

function captureSnapshot(): Snapshot {
  return {
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    USERPROFILE: process.env.USERPROFILE,
    HOMEDRIVE: process.env.HOMEDRIVE,
    HOMEPATH: process.env.HOMEPATH,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
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
  isolatedRoots.push(root)
  const home = path.join(root, "home")
  const appData = path.join(root, "appdata")
  const localAppData = path.join(root, "localappdata")
  const tmp = path.join(root, "tmp")

  await Promise.all([
    fs.mkdir(home, { recursive: true }),
    fs.mkdir(appData, { recursive: true }),
    fs.mkdir(localAppData, { recursive: true }),
    fs.mkdir(tmp, { recursive: true })
  ])

  process.env.HOME = home
  delete process.env.XDG_CONFIG_HOME
  delete process.env.XDG_DATA_HOME
  delete process.env.XDG_CACHE_HOME
  delete process.env.XDG_STATE_HOME
  process.env.USERPROFILE = home
  process.env.HOMEDRIVE = ""
  process.env.HOMEPATH = home
  process.env.APPDATA = appData
  process.env.LOCALAPPDATA = localAppData
  process.env.TMPDIR = tmp
  process.env.TMP = tmp
  process.env.TEMP = tmp
}

export async function teardownIsolatedTestEnv(): Promise<void> {
  if (!snapshot) return
  restoreValue("HOME", snapshot.HOME)
  restoreValue("XDG_CONFIG_HOME", snapshot.XDG_CONFIG_HOME)
  restoreValue("XDG_DATA_HOME", snapshot.XDG_DATA_HOME)
  restoreValue("XDG_CACHE_HOME", snapshot.XDG_CACHE_HOME)
  restoreValue("XDG_STATE_HOME", snapshot.XDG_STATE_HOME)
  restoreValue("USERPROFILE", snapshot.USERPROFILE)
  restoreValue("HOMEDRIVE", snapshot.HOMEDRIVE)
  restoreValue("HOMEPATH", snapshot.HOMEPATH)
  restoreValue("APPDATA", snapshot.APPDATA)
  restoreValue("LOCALAPPDATA", snapshot.LOCALAPPDATA)
  restoreValue("TMPDIR", snapshot.TMPDIR)
  restoreValue("TMP", snapshot.TMP)
  restoreValue("TEMP", snapshot.TEMP)

  while (isolatedRoots.length > 0) {
    const root = isolatedRoots.pop()
    if (!root) continue
    await fs.rm(root, { recursive: true, force: true, maxRetries: 2, retryDelay: 25 }).catch(() => {
      // best-effort cleanup only
    })
  }
}
