import { describe, it, expect, beforeEach, afterEach } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"

import { toolOutputForStatus } from "../lib/codex-status-tool"
import { saveAuthStorage } from "../lib/storage"
import { saveSnapshots } from "../lib/codex-status-storage"

describe("codex-status tool", () => {
  let tmpDir: string
  let authPath: string
  let snapshotsPath: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-status-tool-test-"))
    authPath = path.join(tmpDir, "auth.json")
    snapshotsPath = path.join(tmpDir, "snapshots.json")
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("returns human-readable status containing the email", async () => {
    await saveAuthStorage(authPath, (auth) => {
      auth.openai = {
        type: "oauth",
        accounts: [
          {
            identityKey: "acc1|test@example.com|free",
            email: "test@example.com",
            enabled: true,
            access: "at1",
            refresh: "rt1",
            expires: Date.now() + 3600000
          }
        ],
        activeIdentityKey: "acc1|test@example.com|free"
      }
    })

    await saveSnapshots(snapshotsPath, () => ({
      "acc1|test@example.com|free": {
        updatedAt: Date.now(),
        modelFamily: "o3-mini",
        limits: [
          { name: "Requests", leftPct: 80 }
        ]
      }
    }))

    const output = await toolOutputForStatus(authPath, snapshotsPath)
    expect(output).toContain("test@example.com")
    expect(output).toContain("80% left")
    expect(output).toContain(snapshotsPath)
  })

  it("handles missing snapshots gracefully", async () => {
    await saveAuthStorage(authPath, (auth) => {
      auth.openai = {
        type: "oauth",
        accounts: [
          {
            identityKey: "acc1|test@example.com|free",
            email: "test@example.com",
            enabled: true
          }
        ]
      }
    })

    const output = await toolOutputForStatus(authPath, snapshotsPath)
    expect(output).toContain("test@example.com")
    expect(output).toContain("(no snapshot)")
  })
})
