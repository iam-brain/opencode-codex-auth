import { afterAll, afterEach, beforeAll } from "vitest"

import { setupIsolatedTestEnv, teardownIsolatedTestEnv } from "./helpers/isolate-env.js"

let baselineEnv: Record<string, string | undefined> = {}

function restoreToBaseline(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in baselineEnv)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(baselineEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

beforeAll(async () => {
  await setupIsolatedTestEnv()
  baselineEnv = { ...process.env }
})

afterEach(() => {
  restoreToBaseline()
})

afterAll(async () => {
  await teardownIsolatedTestEnv()
})
