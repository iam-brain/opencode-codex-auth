import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { opencodeSessionFilePath } from "../lib/paths.js"

describe("paths", () => {
  it("builds a session file path for safe keys", () => {
    const root = path.join(os.tmpdir(), "opencode-paths-test")
    const filePath = opencodeSessionFilePath("ses_abc123", { XDG_DATA_HOME: root })
    expect(filePath).toBe(path.join(root, "opencode", "storage", "session", "ses_abc123.json"))
  })

  it("rejects unsafe session keys", () => {
    const root = path.join(os.tmpdir(), "opencode-paths-test")

    expect(() => opencodeSessionFilePath("../escape", { XDG_DATA_HOME: root })).toThrow("invalid_session_key")
    expect(() => opencodeSessionFilePath("/abs/path", { XDG_DATA_HOME: root })).toThrow("invalid_session_key")
    expect(() => opencodeSessionFilePath("a/b", { XDG_DATA_HOME: root })).toThrow("invalid_session_key")
    expect(() => opencodeSessionFilePath("a\\b", { XDG_DATA_HOME: root })).toThrow("invalid_session_key")
    expect(() => opencodeSessionFilePath("   ", { XDG_DATA_HOME: root })).toThrow("invalid_session_key")
  })
})
