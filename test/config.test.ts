import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  getCompatInputSanitizerEnabled,
  getCustomSettings,
  getDebugEnabled,
  getHeaderSnapshotsEnabled,
  getMode,
  getPidOffsetEnabled,
  getPersonality,
  getProactiveRefreshBufferMs,
  getProactiveRefreshEnabled,
  getSpoofMode,
  getThinkingSummariesOverride,
  getQuietMode,
  loadConfigFile,
  resolveConfig
} from "../lib/config"

describe("config loading", () => {
  it("prefers env debug flag", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_AUTH_DEBUG: "1" } })
    expect(getDebugEnabled(cfg)).toBe(true)
  })

  it("defaults debug false", () => {
    const cfg = resolveConfig({ env: {} })
    expect(getDebugEnabled(cfg)).toBe(false)
  })

  it("parses personality from env", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_PERSONALITY: "friendly" } })
    expect(getPersonality(cfg)).toBe("friendly")
  })

  it("accepts custom personality names from env", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_PERSONALITY: "pirate" } })
    expect(getPersonality(cfg)).toBe("pirate")
  })

  it("rejects unsafe personality names from env", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_PERSONALITY: "../pirate" } })
    expect(getPersonality(cfg)).toBeUndefined()
  })

  it("parses quiet mode from env", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_QUIET: "true" } })
    expect(getQuietMode(cfg)).toBe(true)
  })

  it("defaults pid offset to false", () => {
    const cfg = resolveConfig({ env: {} })
    expect(getPidOffsetEnabled(cfg)).toBe(false)
  })

  it("parses pid offset from env", () => {
    const enabled = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_PID_OFFSET: "1" } })
    const disabled = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_PID_OFFSET: "0" } })
    expect(getPidOffsetEnabled(enabled)).toBe(true)
    expect(getPidOffsetEnabled(disabled)).toBe(false)
  })

  it("parses spoof mode from env", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_SPOOF_MODE: "codex" } })
    expect(getSpoofMode(cfg)).toBe("codex")
    expect(getMode(cfg)).toBe("codex")
  })

  it("ignores invalid spoof mode from env", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_SPOOF_MODE: "legacy" } })
    expect(getSpoofMode(cfg)).toBe("native")
  })

  it("accepts legacy spoof mode aliases from env", () => {
    const strictAlias = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_SPOOF_MODE: "strict" } })
    const nativeAlias = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_SPOOF_MODE: "native" } })
    expect(getSpoofMode(strictAlias)).toBe("codex")
    expect(getSpoofMode(nativeAlias)).toBe("native")
  })

  it("accepts standard alias from env for backward compatibility", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_SPOOF_MODE: "standard" } })
    expect(getSpoofMode(cfg)).toBe("native")
    expect(getMode(cfg)).toBe("native")
  })

  it("parses runtime mode from env", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_MODE: "collab" } })
    expect(getMode(cfg)).toBe("collab")
    expect(getSpoofMode(cfg)).toBe("codex")
  })

  it("parses compat input sanitizer from env", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_COMPAT_INPUT_SANITIZER: "1" } })
    expect(getCompatInputSanitizerEnabled(cfg)).toBe(true)
  })

  it("enables header snapshots from env flags", () => {
    const cfgExplicit = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS: "1" } })
    const cfgCompat = resolveConfig({ env: { ENABLE_PLUGIN_REQUEST_LOGGING: "1" } })
    expect(getHeaderSnapshotsEnabled(cfgExplicit)).toBe(true)
    expect(getHeaderSnapshotsEnabled(cfgCompat)).toBe(true)
  })

  it("reads personality + custom settings from file config", () => {
    const cfg = resolveConfig({
      env: {},
      file: {
        customSettings: {
          thinkingSummaries: false,
          options: { personality: "friendly" },
          models: {
            "gpt-5.3-codex": {
              options: { personality: "pragmatic" }
            }
          }
        }
      }
    })

    expect(getPersonality(cfg)).toBe("friendly")
    expect(getThinkingSummariesOverride(cfg)).toBe(false)
    expect(getCustomSettings(cfg)?.models?.["gpt-5.3-codex"]?.options?.personality).toBe("pragmatic")
  })

  it("lets env personality override file custom settings", () => {
    const cfg = resolveConfig({
      env: { OPENCODE_OPENAI_MULTI_PERSONALITY: "pirate" },
      file: {
        customSettings: {
          options: { personality: "friendly" }
        }
      }
    })

    expect(getPersonality(cfg)).toBe("pirate")
    expect(getCustomSettings(cfg)?.options?.personality).toBe("pirate")
  })

  it("lets env thinking summaries override file custom settings", () => {
    const cfg = resolveConfig({
      env: { OPENCODE_OPENAI_MULTI_THINKING_SUMMARIES: "1" },
      file: {
        customSettings: {
          thinkingSummaries: false
        }
      }
    })

    expect(getThinkingSummariesOverride(cfg)).toBe(true)
  })
})

describe("config", () => {
  it("defaults proactive refresh to false", () => {
    expect(getProactiveRefreshEnabled({})).toBe(false)
  })

  it("enables proactive refresh via config flag", () => {
    expect(getProactiveRefreshEnabled({ proactiveRefresh: true })).toBe(true)
  })

  it("defaults buffer to 60s", () => {
    expect(getProactiveRefreshBufferMs({})).toBe(60_000)
  })

  it("uses custom buffer when provided", () => {
    expect(getProactiveRefreshBufferMs({ proactiveRefreshBufferMs: 30_000 })).toBe(30_000)
  })

  it("clamps and floors buffer", () => {
    expect(getProactiveRefreshBufferMs({ proactiveRefreshBufferMs: -500 })).toBe(0)
    expect(getProactiveRefreshBufferMs({ proactiveRefreshBufferMs: 1234.56 })).toBe(1234)
  })

  it("defaults compat input sanitizer to false", () => {
    expect(getCompatInputSanitizerEnabled({})).toBe(false)
  })
})

describe("config file loading", () => {
  it("loads JSON config from explicit path env", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-openai-multi-config-file-"))
    const filePath = path.join(root, "codex-config.json")
    await fs.writeFile(
      filePath,
      JSON.stringify({
        quiet: true,
        refreshAhead: {
          enabled: true,
          bufferMs: 45_000
        },
        runtime: {
          identityMode: "codex",
          sanitizeInputs: true,
          headerSnapshots: true,
          pidOffset: true
        },
        global: {
          thinkingSummaries: true,
          personality: "friendly"
        },
        perModel: {
          "gpt-5.3-codex": {
            personality: "pirate",
            thinkingSummaries: false,
            variants: {
              high: { personality: "strict", thinkingSummaries: true }
            }
          }
        }
      }),
      "utf8"
    )

    const loaded = loadConfigFile({
      env: { OPENCODE_OPENAI_MULTI_CONFIG_PATH: filePath }
    })

    expect(loaded.quietMode).toBe(true)
    expect(loaded.proactiveRefresh).toBe(true)
    expect(loaded.proactiveRefreshBufferMs).toBe(45_000)
    expect(loaded.spoofMode).toBe("codex")
    expect(loaded.compatInputSanitizer).toBe(true)
    expect(loaded.headerSnapshots).toBe(true)
    expect(loaded.pidOffsetEnabled).toBe(true)
    expect(loaded.mode).toBe("codex")
    expect(loaded.customSettings?.thinkingSummaries).toBe(true)
    expect(loaded.customSettings?.options?.personality).toBe("friendly")
    expect(loaded.customSettings?.models?.["gpt-5.3-codex"]?.options?.personality).toBe("pirate")
    expect(loaded.customSettings?.models?.["gpt-5.3-codex"]?.thinkingSummaries).toBe(false)
    expect(loaded.customSettings?.models?.["gpt-5.3-codex"]?.variants?.high?.options?.personality).toBe(
      "strict"
    )
    expect(loaded.customSettings?.models?.["gpt-5.3-codex"]?.variants?.high?.thinkingSummaries).toBe(true)
    expect(loaded.personality).toBe("friendly")
  })

  it("accepts top-level mode field in config file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-openai-multi-config-file-"))
    const filePath = path.join(root, "codex-config.json")
    await fs.writeFile(filePath, JSON.stringify({ mode: "codex" }), "utf8")

    const loaded = loadConfigFile({
      env: { OPENCODE_OPENAI_MULTI_CONFIG_PATH: filePath }
    })

    expect(loaded.mode).toBe("codex")
    expect(loaded.spoofMode).toBe("codex")
  })

  it("accepts runtime.mode field in config file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-openai-multi-config-file-"))
    const filePath = path.join(root, "codex-config.json")
    await fs.writeFile(
      filePath,
      JSON.stringify({
        runtime: { mode: "codex" }
      }),
      "utf8"
    )

    const loaded = loadConfigFile({
      env: { OPENCODE_OPENAI_MULTI_CONFIG_PATH: filePath }
    })

    expect(loaded.mode).toBe("codex")
    expect(loaded.spoofMode).toBe("codex")
  })

  it("accepts collab mode field in config file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-openai-multi-config-file-"))
    const filePath = path.join(root, "codex-config.json")
    await fs.writeFile(filePath, JSON.stringify({ mode: "collab" }), "utf8")

    const loaded = loadConfigFile({
      env: { OPENCODE_OPENAI_MULTI_CONFIG_PATH: filePath }
    })

    expect(loaded.mode).toBe("collab")
    expect(loaded.spoofMode).toBe("codex")
  })

  it("loads codex-config.json from XDG config home", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-openai-multi-config-file-"))
    const configDir = path.join(root, "opencode")
    await fs.mkdir(configDir, { recursive: true })
    const filePath = path.join(configDir, "codex-config.json")
    await fs.writeFile(filePath, JSON.stringify({ quietMode: true }), "utf8")

    const loaded = loadConfigFile({ env: { XDG_CONFIG_HOME: root } })
    expect(loaded.quietMode).toBe(true)
  })

  it("falls back to legacy config filename in XDG config home", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-openai-multi-config-file-"))
    const configDir = path.join(root, "opencode")
    await fs.mkdir(configDir, { recursive: true })
    const filePath = path.join(configDir, "openai-codex-auth-config.json")
    await fs.writeFile(filePath, JSON.stringify({ quietMode: true }), "utf8")

    const loaded = loadConfigFile({ env: { XDG_CONFIG_HOME: root } })
    expect(loaded.quietMode).toBe(true)
  })

  it("parses legacy config aliases for backward compatibility", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-openai-multi-config-file-"))
    const filePath = path.join(root, "codex-config.json")
    await fs.writeFile(
      filePath,
      JSON.stringify({
        authDebug: true,
        proactiveTokenRefresh: true,
        tokenRefreshSkewMs: 12_345,
        codexSpoofMode: "strict",
        compat: { inputSanitizer: true },
        telemetry: { requestShapeDebug: true },
        rotation: { pidOffset: true },
        custom_settings: {
          thinking_summaries: true,
          options: { personality: "friendly" }
        }
      }),
      "utf8"
    )

    const loaded = loadConfigFile({
      env: { OPENCODE_OPENAI_MULTI_CONFIG_PATH: filePath }
    })
    expect(loaded.debug).toBe(true)
    expect(loaded.proactiveRefresh).toBe(true)
    expect(loaded.proactiveRefreshBufferMs).toBe(12_345)
    expect(loaded.spoofMode).toBe("codex")
    expect(loaded.compatInputSanitizer).toBe(true)
    expect(loaded.headerSnapshots).toBe(true)
    expect(loaded.pidOffsetEnabled).toBe(true)
    expect(loaded.customSettings?.thinkingSummaries).toBe(true)
    expect(loaded.customSettings?.options?.personality).toBe("friendly")
  })
})
