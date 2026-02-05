import { describe, expect, it } from "vitest"

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { toolOutputForStatus } from "../lib/codex-status-tool"
import { saveSnapshots } from "../lib/codex-status-storage"
import { saveAuthStorage } from "../lib/storage"

describe("plugin wiring", () => {
  it("does not include filesystem paths in tool output strings", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-plugin-wiring-"))
    const authPath = path.join(dir, "auth.json")
    const snapshotsPath = path.join(dir, "snapshots.json")

    try {
      await saveAuthStorage(authPath, (auth) => {
        auth.openai = {
          type: "oauth",
          accounts: [{
            identityKey: "acc|u@e.com|plus",
            email: "u@e.com",
            plan: "plus",
            enabled: true,
            access: "at",
            refresh: "rt",
            expires: 1
          }],
          activeIdentityKey: "acc|u@e.com|plus"
        }
      })

      await saveSnapshots(snapshotsPath, () => ({
        "acc|u@e.com|plus": {
          updatedAt: 1,
          modelFamily: "gpt-5.2",
          limits: [{ name: "requests", leftPct: 50 }]
        }
      }))

      const out = await toolOutputForStatus(authPath, snapshotsPath)
      expect(out).not.toContain(dir)
      expect(out).not.toContain(authPath)
      expect(out).not.toContain(snapshotsPath)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
