import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { defaultOpencodeConfigPath, defaultOpencodeDataPath, opencodeSessionFilePath } from "../lib/paths.js"

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

  it("ignores relative XDG environment values", () => {
    expect(defaultOpencodeDataPath({ XDG_DATA_HOME: "relative-data-root" })).toBe(path.join(os.homedir(), ".local", "share"))
    expect(defaultOpencodeConfigPath({ XDG_CONFIG_HOME: "relative-config-root" })).toBe(
      path.join(os.homedir(), ".config", "opencode")
    )
  })

  it("uses absolute XDG environment values", () => {
    const dataRoot = path.join(os.tmpdir(), "opencode-abs-data")
    const configRoot = path.join(os.tmpdir(), "opencode-abs-config")
    expect(defaultOpencodeDataPath({ XDG_DATA_HOME: dataRoot })).toBe(dataRoot)
    expect(defaultOpencodeConfigPath({ XDG_CONFIG_HOME: configRoot })).toBe(path.join(configRoot, "opencode"))
  })
})
