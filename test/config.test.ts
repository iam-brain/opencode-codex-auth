import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  DEFAULT_CODEX_CONFIG,
  ensureDefaultConfigFile,
  getCompatInputSanitizerEnabled,
  getCustomSettings,
  getDebugEnabled,
  getHeaderTransformDebugEnabled,
  getHeaderSnapshotsEnabled,
  getMode,
  getRotationStrategy,
  getPidOffsetEnabled,
  getPersonality,
  getProactiveRefreshBufferMs,
  getProactiveRefreshEnabled,
  getSpoofMode,
  getThinkingSummariesOverride,
  getQuietMode,
  loadConfigFile,
  parseConfigJsonWithComments,
  resolveConfig
} from "../lib/config"

describe("config loading", () => {
  it("prefers env debug flag", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_DEBUG: "1" } })
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

  it("defaults rotation strategy to sticky", () => {
    const cfg = resolveConfig({ env: {} })
    expect(getRotationStrategy(cfg)).toBe("sticky")
  })

  it("parses rotation strategy from env", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_ROTATION_STRATEGY: "hybrid" } })
    expect(getRotationStrategy(cfg)).toBe("hybrid")
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

  it("parses runtime mode from env", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_MODE: "collab" } })
    expect(getMode(cfg)).toBe("collab")
    expect(getSpoofMode(cfg)).toBe("codex")
  })

  it("lets spoof env temporarily override file runtime mode", () => {
    const cfg = resolveConfig({
      env: { OPENCODE_OPENAI_MULTI_SPOOF_MODE: "codex" },
      file: { mode: "native" }
    })
    expect(getMode(cfg)).toBe("codex")
    expect(getSpoofMode(cfg)).toBe("codex")
  })

  it("keeps explicit runtime env mode higher priority than spoof env", () => {
    const cfg = resolveConfig({
      env: {
        OPENCODE_OPENAI_MULTI_MODE: "native",
        OPENCODE_OPENAI_MULTI_SPOOF_MODE: "codex"
      },
      file: { mode: "codex" }
    })
    expect(getMode(cfg)).toBe("native")
    expect(getSpoofMode(cfg)).toBe("codex")
  })

  it("parses compat input sanitizer from env", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_COMPAT_INPUT_SANITIZER: "1" } })
    expect(getCompatInputSanitizerEnabled(cfg)).toBe(true)
  })

  it("enables header snapshots from env flags", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS: "1" } })
    expect(getHeaderSnapshotsEnabled(cfg)).toBe(true)
  })

  it("enables header transform debug from env flags", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_HEADER_TRANSFORM_DEBUG: "1" } })
    expect(getHeaderTransformDebugEnabled(cfg)).toBe(true)
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
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
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
          mode: "codex",
          rotationStrategy: "hybrid",
          sanitizeInputs: true,
          headerSnapshots: true,
          headerTransformDebug: true,
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
    expect(loaded.headerTransformDebug).toBe(true)
    expect(loaded.pidOffsetEnabled).toBe(true)
    expect(loaded.rotationStrategy).toBe("hybrid")
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

  it("ignores top-level mode field in config file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const filePath = path.join(root, "codex-config.json")
    await fs.writeFile(filePath, JSON.stringify({ mode: "codex" }), "utf8")

    const loaded = loadConfigFile({
      env: { OPENCODE_OPENAI_MULTI_CONFIG_PATH: filePath }
    })

    expect(loaded.mode).toBeUndefined()
    expect(loaded.spoofMode).toBeUndefined()
  })

  it("accepts runtime.mode field in config file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
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

  it("accepts runtime.collab mode field in config file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const filePath = path.join(root, "codex-config.json")
    await fs.writeFile(
      filePath,
      JSON.stringify({
        runtime: { mode: "collab" }
      }),
      "utf8"
    )

    const loaded = loadConfigFile({
      env: { OPENCODE_OPENAI_MULTI_CONFIG_PATH: filePath }
    })

    expect(loaded.mode).toBe("collab")
    expect(loaded.spoofMode).toBe("codex")
  })

  it("loads codex-config.json from XDG config home", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const configDir = path.join(root, "opencode")
    await fs.mkdir(configDir, { recursive: true })
    const filePath = path.join(configDir, "codex-config.json")
    await fs.writeFile(filePath, JSON.stringify({ quiet: true }), "utf8")

    const loaded = loadConfigFile({ env: { XDG_CONFIG_HOME: root } })
    expect(loaded.quietMode).toBe(true)
  })

  it("creates default codex config when missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const result = await ensureDefaultConfigFile({ env: { XDG_CONFIG_HOME: root } })
    const raw = await fs.readFile(result.filePath, "utf8")
    const written = parseConfigJsonWithComments(raw) as unknown

    expect(result.created).toBe(true)
    expect(raw).toContain("// default: \"native\"")
    expect(raw).toContain("// default: \"sticky\"")
    expect(raw).toContain("// Thinking summaries behavior:")
    expect(written).toEqual(DEFAULT_CODEX_CONFIG)
  })

  it("does not overwrite existing codex config by default", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const configDir = path.join(root, "opencode")
    const filePath = path.join(configDir, "codex-config.json")
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(filePath, JSON.stringify({ debug: true }), "utf8")

    const result = await ensureDefaultConfigFile({ env: { XDG_CONFIG_HOME: root } })
    const written = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown

    expect(result.created).toBe(false)
    expect(written).toEqual({ debug: true })
  })

  it("overwrites codex config when requested", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const configDir = path.join(root, "opencode")
    const filePath = path.join(configDir, "codex-config.json")
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(filePath, JSON.stringify({ debug: true }), "utf8")

    const result = await ensureDefaultConfigFile({
      env: { XDG_CONFIG_HOME: root },
      overwrite: true
    })
    const raw = await fs.readFile(filePath, "utf8")
    const written = parseConfigJsonWithComments(raw) as unknown

    expect(result.created).toBe(true)
    expect(raw).toContain("// Optional model-specific overrides.")
    expect(written).toEqual(DEFAULT_CODEX_CONFIG)
  })

  it("loads config JSON with line and block comments", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const filePath = path.join(root, "codex-config.json")
    await fs.writeFile(
      filePath,
      `{
        // line comment
        "quiet": true,
        /* block comment */
        "runtime": { "mode": "codex" }
      }
      `,
      "utf8"
    )

    const loaded = loadConfigFile({ filePath })
    expect(loaded.quietMode).toBe(true)
    expect(loaded.mode).toBe("codex")
    expect(loaded.spoofMode).toBe("codex")
  })
})
