import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  DEFAULT_PLUGIN_SPECIFIER,
  defaultOpencodeConfigPath,
  ensurePluginInstalled
} from "../lib/opencode-install"

describe("opencode installer config", () => {
  it("uses XDG root for default opencode.json path", () => {
    const configPath = defaultOpencodeConfigPath({ XDG_CONFIG_HOME: "/tmp/xdg-root" })
    expect(configPath).toBe(path.join("/tmp/xdg-root", "opencode", "opencode.json"))
  })

  it("creates config and installs plugin specifier", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-"))
    const configPath = path.join(root, "opencode.json")

    const first = await ensurePluginInstalled({ configPath })
    expect(first.created).toBe(true)
    expect(first.changed).toBe(true)
    expect(first.plugins).toContain(DEFAULT_PLUGIN_SPECIFIER)

    const second = await ensurePluginInstalled({ configPath })
    expect(second.created).toBe(false)
    expect(second.changed).toBe(false)

    const raw = JSON.parse(await fs.readFile(configPath, "utf8")) as { plugin: string[] }
    expect(raw.plugin).toContain(DEFAULT_PLUGIN_SPECIFIER)
  })
})
