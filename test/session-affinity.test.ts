import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  createSessionExistsFn,
  loadSessionAffinity,
  pruneSessionAffinitySnapshot,
  readSessionAffinitySnapshot,
  saveSessionAffinity,
  writeSessionAffinitySnapshot
} from "../lib/session-affinity"

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
})
