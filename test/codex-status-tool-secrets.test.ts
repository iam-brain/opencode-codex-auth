import { afterEach, describe, expect, it, vi } from "vitest"

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { saveAuthStorage } from "../lib/storage"
import { saveSnapshots } from "../lib/codex-status-storage"

describe("codex-status tool secrets hygiene", () => {
  afterEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it("does not pass tokens to dashboard renderer", async () => {
    vi.doMock("../lib/codex-status-ui", () => {
      return {
        renderDashboard: (input: { accounts: unknown }) => {
          return [JSON.stringify(input.accounts)]
        }
      }
    })

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-status-tool-secrets-"))
    const authPath = path.join(dir, "auth.json")
    const snapshotsPath = path.join(dir, "snapshots.json")

    try {
      await saveAuthStorage(authPath, (auth) => {
        auth.openai = {
          type: "oauth",
          accounts: [
            {
              identityKey: "acc1|test@example.com|free",
              email: "test@example.com",
              plan: "free",
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
          limits: [{ name: "Requests", leftPct: 80 }]
        }
      }))

      const { toolOutputForStatus } = await import("../lib/codex-status-tool")
      const output = await toolOutputForStatus(authPath, snapshotsPath)

      expect(output).not.toContain("at1")
      expect(output).not.toContain("rt1")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
