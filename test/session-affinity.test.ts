import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import lockfile from "proper-lockfile"

import { describe, expect, it } from "vitest"

import {
  createSessionExistsFn,
  loadSessionAffinity,
  pruneSessionAffinitySnapshot,
  readSessionAffinitySnapshot,
  saveSessionAffinity,
  writeSessionAffinitySnapshot
} from "../lib/session-affinity"
import { lockTargetPathForFile } from "../lib/cache-lock"

describe("session affinity storage", () => {
  it("persists sticky/hybrid maps and seen sessions by mode", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-session-affinity-"))
    const filePath = path.join(root, "codex-session-affinity.json")

    await saveSessionAffinity(
      async (current) =>
        writeSessionAffinitySnapshot(current, "codex", {
          seenSessionKeys: new Map([["ses_a", 1000]]),
          stickyBySessionKey: new Map([["ses_a", "id_a"]]),
          hybridBySessionKey: new Map([["ses_b", "id_b"]])
        }),
      filePath
    )

    const loaded = await loadSessionAffinity(filePath)
    const snapshot = readSessionAffinitySnapshot(loaded, "codex")
    expect(snapshot.seenSessionKeys.get("ses_a")).toBe(1000)
    expect(snapshot.stickyBySessionKey.get("ses_a")).toBe("id_a")
    expect(snapshot.hybridBySessionKey.get("ses_b")).toBe("id_b")
    const mode = (await fs.stat(filePath)).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it("tolerates missing or malformed files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-session-affinity-"))
    const filePath = path.join(root, "codex-session-affinity.json")
    await fs.writeFile(filePath, "not-json", "utf8")

    const loaded = await loadSessionAffinity(filePath)
    const snapshot = readSessionAffinitySnapshot(loaded, "native")
    expect(snapshot.seenSessionKeys.size).toBe(0)
    expect(snapshot.stickyBySessionKey.size).toBe(0)
    expect(snapshot.hybridBySessionKey.size).toBe(0)
  })

  it("prunes missing sessions from all maps", async () => {
    const snapshot = {
      seenSessionKeys: new Map([
        ["ses_keep", 1000],
        ["ses_drop", 1200]
      ]),
      stickyBySessionKey: new Map([
        ["ses_keep", "id_keep"],
        ["ses_drop", "id_drop"]
      ]),
      hybridBySessionKey: new Map([["ses_drop", "id_drop"]])
    }

    const removed = await pruneSessionAffinitySnapshot(snapshot, async (sessionKey) => {
      return sessionKey === "ses_keep"
    })

    expect(removed).toBe(1)
    expect(snapshot.seenSessionKeys.has("ses_keep")).toBe(true)
    expect(snapshot.seenSessionKeys.has("ses_drop")).toBe(false)
    expect(snapshot.stickyBySessionKey.has("ses_drop")).toBe(false)
    expect(snapshot.hybridBySessionKey.has("ses_drop")).toBe(false)
  })

  it("keeps recent missing sessions during grace window", async () => {
    const snapshot = {
      seenSessionKeys: new Map([
        ["ses_recent", 1000],
        ["ses_stale", 10]
      ]),
      stickyBySessionKey: new Map([
        ["ses_recent", "id_recent"],
        ["ses_stale", "id_stale"]
      ]),
      hybridBySessionKey: new Map([["ses_stale", "id_stale"]])
    }

    const removed = await pruneSessionAffinitySnapshot(snapshot, async () => false, {
      now: 1200,
      missingGraceMs: 500
    })

    expect(removed).toBe(1)
    expect(snapshot.seenSessionKeys.has("ses_recent")).toBe(true)
    expect(snapshot.seenSessionKeys.has("ses_stale")).toBe(false)
    expect(snapshot.stickyBySessionKey.has("ses_recent")).toBe(true)
    expect(snapshot.stickyBySessionKey.has("ses_stale")).toBe(false)
    expect(snapshot.hybridBySessionKey.has("ses_stale")).toBe(false)
  })

  it("checks opencode session files via XDG_DATA_HOME", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-session-exists-"))
    const sessionDir = path.join(root, "opencode", "storage", "session")
    await fs.mkdir(sessionDir, { recursive: true })
    await fs.writeFile(path.join(sessionDir, "ses_real.json"), "{}", "utf8")

    const exists = createSessionExistsFn({ XDG_DATA_HOME: root })
    expect(await exists("ses_real")).toBe(true)
    expect(await exists("ses_missing")).toBe(false)
    expect(await exists("../bad")).toBe(false)
  })

  it("does not write session affinity file until lock is acquired", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-session-affinity-"))
    const filePath = path.join(root, "codex-session-affinity.json")

    const lockTarget = lockTargetPathForFile(filePath)
    await fs.writeFile(lockTarget, "", "utf8")
    const release = await lockfile.lock(lockTarget, {
      realpath: true,
      retries: {
        retries: 0
      }
    })

    const pendingWrite = saveSessionAffinity(
      async (current) =>
        writeSessionAffinitySnapshot(current, "native", {
          seenSessionKeys: new Map([["ses_lock", Date.now()]]),
          stickyBySessionKey: new Map([["ses_lock", "id_lock"]]),
          hybridBySessionKey: new Map()
        }),
      filePath
    )

    await new Promise((resolve) => setTimeout(resolve, 50))
    await expect(fs.access(filePath)).rejects.toBeDefined()

    await release()
    await pendingWrite
    await expect(fs.access(filePath)).resolves.toBeUndefined()
  })

  it("removes deleted session keys after grace window based on opencode storage", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-session-delete-"))
    const sessionDir = path.join(root, "opencode", "storage", "session")
    await fs.mkdir(sessionDir, { recursive: true })

    await fs.writeFile(path.join(sessionDir, "ses_keep.json"), "{}", "utf8")
    await fs.writeFile(path.join(sessionDir, "ses_drop.json"), "{}", "utf8")

    const snapshot = {
      seenSessionKeys: new Map([
        ["ses_keep", 1_000],
        ["ses_drop", 1_000]
      ]),
      stickyBySessionKey: new Map([
        ["ses_keep", "id_keep"],
        ["ses_drop", "id_drop"]
      ]),
      hybridBySessionKey: new Map([["ses_drop", "id_drop"]])
    }

    const exists = createSessionExistsFn({ XDG_DATA_HOME: root })

    const initial = await pruneSessionAffinitySnapshot(snapshot, exists, {
      now: 1_100,
      missingGraceMs: 5_000
    })
    expect(initial).toBe(0)

    await fs.unlink(path.join(sessionDir, "ses_drop.json"))

    const withinGrace = await pruneSessionAffinitySnapshot(snapshot, exists, {
      now: 1_300,
      missingGraceMs: 5_000
    })
    expect(withinGrace).toBe(0)
    expect(snapshot.seenSessionKeys.has("ses_drop")).toBe(true)

    const afterGrace = await pruneSessionAffinitySnapshot(snapshot, exists, {
      now: 7_000,
      missingGraceMs: 5_000
    })
    expect(afterGrace).toBe(1)
    expect(snapshot.seenSessionKeys.has("ses_drop")).toBe(false)
    expect(snapshot.stickyBySessionKey.has("ses_drop")).toBe(false)
    expect(snapshot.hybridBySessionKey.has("ses_drop")).toBe(false)
  })
})
