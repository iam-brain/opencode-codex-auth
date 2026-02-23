import { afterAll, afterEach, beforeAll } from "vitest"

import { setupIsolatedTestEnv, teardownIsolatedTestEnv } from "./helpers/isolate-env.js"

let baselineEnv: Record<string, string | undefined> = {}

function restoreToBaseline(): void {
  const keys = [
    "HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "TMPDIR",
    "TMP",
    "TEMP"
  ] as const

  for (const key of keys) {
    const value = baselineEnv[key]
    if (value === undefined) {
      delete process.env[key]
      continue
    }
    process.env[key] = value
  }
}

beforeAll(async () => {
  await setupIsolatedTestEnv()
  baselineEnv = {
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
})

afterEach(() => {
  restoreToBaseline()
})

afterAll(async () => {
  await teardownIsolatedTestEnv()
})
