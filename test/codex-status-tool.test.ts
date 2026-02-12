import { afterEach, beforeEach, describe, expect, it } from "vitest"

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

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
        limits: [{ name: "Requests", leftPct: 80 }]
      }
    }))

    const output = await toolOutputForStatus(authPath, snapshotsPath)
    expect(output).toContain("test@example.com")
    expect(output).toContain("80% left")
    expect(output).toContain("5h")
    expect(output).toContain("Weekly")
    expect(output).toContain("Credits")
  })

  it("handles missing snapshots gracefully", async () => {
    await saveAuthStorage(authPath, (auth) => {
      auth.openai = {
        type: "oauth",
        accounts: [
          {
            identityKey: "acc1|test@example.com|free",
            email: "test@example.com",
            enabled: true,
            expires: Date.now() - 60_000
          }
        ]
      }
    })

    const output = await toolOutputForStatus(authPath, snapshotsPath)
    expect(output).toContain("test@example.com")
    expect(output).toContain("5h")
    expect(output).toContain("Weekly")
    expect(output).toContain("Unknown, account expired")
    expect(output).toContain("Credits")
  })

  it("keeps plus/team snapshots isolated by canonical identity key", async () => {
    await saveAuthStorage(authPath, (auth) => {
      auth.openai = {
        type: "oauth",
        accounts: [
          {
            identityKey: "acct_live|alpha@example.com|plus",
            accountId: "acct_live",
            email: "alpha@example.com",
            plan: "plus",
            enabled: true,
            access: "at_plus",
            refresh: "rt_plus",
            expires: Date.now() + 3600000
          },
          {
            // Intentionally stale identity key to ensure storage normalization re-canonicalizes.
            identityKey: "acct_live|alpha@example.com|plus",
            accountId: "acct_live",
            email: "alpha@example.com",
            plan: "team",
            enabled: true,
            access: "at_team",
            refresh: "rt_team",
            expires: Date.now() + 3600000
          }
        ],
        activeIdentityKey: "acct_live|alpha@example.com|plus"
      }
    })

    await saveSnapshots(snapshotsPath, () => ({
      "acct_live|alpha@example.com|plus": {
        updatedAt: Date.now(),
        modelFamily: "gpt-5.3-codex",
        limits: [{ name: "requests", leftPct: 80 }]
      },
      "acct_live|alpha@example.com|team": {
        updatedAt: Date.now(),
        modelFamily: "gpt-5.3-codex",
        limits: [{ name: "requests", leftPct: 20 }]
      }
    }))

    const output = await toolOutputForStatus(authPath, snapshotsPath)
    const lines = output.split("\n")
    const plusIndex = lines.findIndex((line) => line.includes("alpha@example.com (plus)"))
    const teamIndex = lines.findIndex((line) => line.includes("alpha@example.com (team)"))

    expect(plusIndex).toBeGreaterThanOrEqual(0)
    expect(teamIndex).toBeGreaterThanOrEqual(0)
    expect(lines[plusIndex + 1]).toContain("80% left")
    expect(lines[teamIndex + 1]).toContain("20% left")
  })
})
