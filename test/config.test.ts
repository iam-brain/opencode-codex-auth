import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  DEFAULT_CODEX_CONFIG,
  ensureDefaultConfigFile,
  getCompatInputSanitizerEnabled,
  getCollaborationProfileEnabled,
  getCollaborationToolProfile,
  getCodexCompactionOverrideEnabled,
  getBehaviorSettings,
  getDebugEnabled,
  getHeaderSnapshotBodiesEnabled,
  getHeaderTransformDebugEnabled,
  getHeaderSnapshotsEnabled,
  getMode,
  getPromptCacheKeyStrategy,
  getOrchestratorSubagentsEnabled,
  getRemapDeveloperMessagesToUserEnabled,
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
  resolveConfig,
  validateConfigFileObject
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

  it("ignores legacy top-level personality passed via resolveConfig file object", () => {
    const cfg = resolveConfig({ env: {}, file: { personality: "friendly" } })
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

  it("defaults prompt cache key strategy to default", () => {
    const cfg = resolveConfig({ env: {} })
    expect(getPromptCacheKeyStrategy(cfg)).toBe("default")
  })

  it("parses prompt cache key strategy from env", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_PROMPT_CACHE_KEY_STRATEGY: "project" } })
    expect(getPromptCacheKeyStrategy(cfg)).toBe("project")
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

  it("ignores unsupported runtime mode from env", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_MODE: "collab" } })
    expect(getMode(cfg)).toBe("native")
    expect(getSpoofMode(cfg)).toBe("native")
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
    expect(getSpoofMode(cfg)).toBe("native")
  })

  it("uses runtime env mode over legacy file spoof mode", () => {
    const cfg = resolveConfig({
      env: {
        OPENCODE_OPENAI_MULTI_MODE: "native"
      },
      file: { mode: "codex", spoofMode: "codex" }
    })
    expect(getMode(cfg)).toBe("native")
    expect(getSpoofMode(cfg)).toBe("native")
  })

  it("parses compat input sanitizer from env", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_COMPAT_INPUT_SANITIZER: "1" } })
    expect(getCompatInputSanitizerEnabled(cfg)).toBe(true)
  })

  it("parses developer-message remap from env", () => {
    const cfg = resolveConfig({
      env: {
        OPENCODE_OPENAI_MULTI_MODE: "codex",
        OPENCODE_OPENAI_MULTI_REMAP_DEVELOPER_MESSAGES_TO_USER: "1"
      }
    })
    expect(getRemapDeveloperMessagesToUserEnabled(cfg)).toBe(true)
  })

  it("defaults developer-message remap to enabled in codex mode", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_MODE: "codex" } })
    expect(getRemapDeveloperMessagesToUserEnabled(cfg)).toBe(true)
  })

  it("parses codex compaction override from env", () => {
    const cfg = resolveConfig({
      env: {
        OPENCODE_OPENAI_MULTI_MODE: "codex",
        OPENCODE_OPENAI_MULTI_CODEX_COMPACTION_OVERRIDE: "1"
      }
    })
    expect(getCodexCompactionOverrideEnabled(cfg)).toBe(true)
  })

  it("enables header snapshots from env flags", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS: "1" } })
    expect(getHeaderSnapshotsEnabled(cfg)).toBe(true)
  })

  it("enables header transform debug from env flags", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_HEADER_TRANSFORM_DEBUG: "1" } })
    expect(getHeaderTransformDebugEnabled(cfg)).toBe(true)
  })

  it("enables header snapshot body capture from env flags", () => {
    const cfg = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOT_BODIES: "1" } })
    expect(getHeaderSnapshotBodiesEnabled(cfg)).toBe(true)
  })

  it("parses collaboration profile gate from env", () => {
    const enabled = resolveConfig({
      env: {
        OPENCODE_OPENAI_MULTI_MODE: "codex",
        OPENCODE_OPENAI_MULTI_COLLABORATION_PROFILE: "1"
      }
    })
    const disabled = resolveConfig({
      env: {
        OPENCODE_OPENAI_MULTI_MODE: "native",
        OPENCODE_OPENAI_MULTI_COLLABORATION_PROFILE: "1"
      }
    })
    expect(getCollaborationProfileEnabled(enabled)).toBe(true)
    expect(getCollaborationProfileEnabled(disabled)).toBe(true)
  })

  it("parses orchestrator subagent gate from env", () => {
    const enabled = resolveConfig({
      env: {
        OPENCODE_OPENAI_MULTI_MODE: "codex",
        OPENCODE_OPENAI_MULTI_COLLABORATION_PROFILE: "1",
        OPENCODE_OPENAI_MULTI_ORCHESTRATOR_SUBAGENTS: "1"
      }
    })
    const disabled = resolveConfig({
      env: {
        OPENCODE_OPENAI_MULTI_MODE: "codex",
        OPENCODE_OPENAI_MULTI_COLLABORATION_PROFILE: "0",
        OPENCODE_OPENAI_MULTI_ORCHESTRATOR_SUBAGENTS: "0"
      }
    })
    expect(getOrchestratorSubagentsEnabled(enabled)).toBe(true)
    expect(getOrchestratorSubagentsEnabled(disabled)).toBe(false)
  })

  it("parses collaboration tooling profile from env", () => {
    const codex = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_COLLABORATION_TOOL_PROFILE: "codex" } })
    const opencode = resolveConfig({ env: { OPENCODE_OPENAI_MULTI_COLLABORATION_TOOL_PROFILE: "opencode" } })
    expect(getCollaborationToolProfile(codex)).toBe("codex")
    expect(getCollaborationToolProfile(opencode)).toBe("opencode")
  })

  it("reads personality + behavior settings from file config", () => {
    const cfg = resolveConfig({
      env: {},
      file: {
        behaviorSettings: {
          global: {
            personality: "friendly",
            thinkingSummaries: false
          },
          perModel: {
            "gpt-5.3-codex": {
              personality: "pragmatic"
            }
          }
        }
      }
    })

    expect(getPersonality(cfg)).toBe("friendly")
    expect(getThinkingSummariesOverride(cfg)).toBe(false)
    expect(getBehaviorSettings(cfg)?.perModel?.["gpt-5.3-codex"]?.personality).toBe("pragmatic")
  })

  it("lets env personality override file behavior settings", () => {
    const cfg = resolveConfig({
      env: { OPENCODE_OPENAI_MULTI_PERSONALITY: "pirate" },
      file: {
        behaviorSettings: {
          global: { personality: "friendly" }
        }
      }
    })

    expect(getPersonality(cfg)).toBe("pirate")
    expect(getBehaviorSettings(cfg)?.global?.personality).toBe("pirate")
  })

  it("lets env thinking summaries override file behavior settings", () => {
    const cfg = resolveConfig({
      env: { OPENCODE_OPENAI_MULTI_THINKING_SUMMARIES: "1" },
      file: {
        behaviorSettings: {
          global: {
            thinkingSummaries: false
          }
        }
      }
    })

    expect(getThinkingSummariesOverride(cfg)).toBe(true)
  })

  it("parses verbosity overrides from env", () => {
    const cfg = resolveConfig({
      env: {
        OPENCODE_OPENAI_MULTI_VERBOSITY_ENABLED: "0",
        OPENCODE_OPENAI_MULTI_VERBOSITY: "low"
      }
    })

    expect(getBehaviorSettings(cfg)?.global?.verbosityEnabled).toBe(false)
    expect(getBehaviorSettings(cfg)?.global?.verbosity).toBe("low")
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

  it("defaults developer-message remap to codex mode only", () => {
    expect(getRemapDeveloperMessagesToUserEnabled({ mode: "native" })).toBe(false)
    expect(getRemapDeveloperMessagesToUserEnabled({ mode: "codex" })).toBe(true)
  })

  it("allows disabling developer-message remap in codex mode", () => {
    expect(
      getRemapDeveloperMessagesToUserEnabled({
        mode: "codex",
        remapDeveloperMessagesToUser: false
      })
    ).toBe(false)
  })

  it("defaults codex compaction override by runtime mode", () => {
    expect(getCodexCompactionOverrideEnabled({ mode: "native" })).toBe(false)
    expect(getCodexCompactionOverrideEnabled({ mode: "codex" })).toBe(true)
  })

  it("defaults collaboration gates to codex-on, native-off", () => {
    expect(getCollaborationProfileEnabled({ mode: "native" })).toBe(false)
    expect(getCollaborationProfileEnabled({ mode: "codex" })).toBe(true)
    expect(getOrchestratorSubagentsEnabled({ mode: "native" })).toBe(false)
    expect(getOrchestratorSubagentsEnabled({ mode: "codex" })).toBe(true)
  })

  it("allows overriding collaboration gates in any mode", () => {
    expect(getCollaborationProfileEnabled({ mode: "native", collaborationProfileEnabled: true })).toBe(true)
    expect(getCollaborationProfileEnabled({ mode: "codex", collaborationProfileEnabled: false })).toBe(false)
    expect(getCollaborationProfileEnabled({ mode: "codex", collaborationProfileEnabled: true })).toBe(true)
    expect(
      getOrchestratorSubagentsEnabled({
        mode: "native",
        collaborationProfileEnabled: true,
        orchestratorSubagentsEnabled: true
      })
    ).toBe(true)
  })

  it("allows enabling codex compaction override in native mode", () => {
    expect(
      getCodexCompactionOverrideEnabled({
        mode: "native",
        codexCompactionOverride: true
      })
    ).toBe(true)
  })

  it("allows disabling codex compaction override in codex mode", () => {
    expect(
      getCodexCompactionOverrideEnabled({
        mode: "codex",
        codexCompactionOverride: false
      })
    ).toBe(false)
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
          promptCacheKeyStrategy: "project",
          sanitizeInputs: true,
          developerMessagesToUser: true,
          codexCompactionOverride: true,
          headerSnapshots: true,
          headerSnapshotBodies: true,
          headerTransformDebug: true,
          pidOffset: true,
          collaborationProfile: true,
          orchestratorSubagents: true,
          collaborationToolProfile: "codex"
        },
        global: {
          thinkingSummaries: true,
          personality: "friendly",
          verbosityEnabled: true,
          verbosity: "high"
        },
        perModel: {
          "gpt-5.3-codex": {
            personality: "pirate",
            thinkingSummaries: false,
            verbosityEnabled: false,
            verbosity: "default",
            variants: {
              high: { personality: "strict", thinkingSummaries: true, verbosityEnabled: true, verbosity: "medium" }
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
    expect(loaded.remapDeveloperMessagesToUser).toBe(true)
    expect(loaded.codexCompactionOverride).toBe(true)
    expect(loaded.headerSnapshots).toBe(true)
    expect(loaded.headerSnapshotBodies).toBe(true)
    expect(loaded.headerTransformDebug).toBe(true)
    expect(loaded.pidOffsetEnabled).toBe(true)
    expect(loaded.collaborationProfileEnabled).toBe(true)
    expect(loaded.orchestratorSubagentsEnabled).toBe(true)
    expect(loaded.collaborationToolProfile).toBe("codex")
    expect(loaded.rotationStrategy).toBe("hybrid")
    expect(loaded.promptCacheKeyStrategy).toBe("project")
    expect(loaded.mode).toBe("codex")
    expect(loaded.behaviorSettings?.global?.thinkingSummaries).toBe(true)
    expect(loaded.behaviorSettings?.global?.verbosityEnabled).toBe(true)
    expect(loaded.behaviorSettings?.global?.verbosity).toBe("high")
    expect(loaded.behaviorSettings?.global?.personality).toBe("friendly")
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.personality).toBe("pirate")
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.thinkingSummaries).toBe(false)
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.verbosityEnabled).toBe(false)
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.verbosity).toBe("default")
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.variants?.high?.personality).toBe("strict")
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.variants?.high?.thinkingSummaries).toBe(true)
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.variants?.high?.verbosityEnabled).toBe(true)
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.variants?.high?.verbosity).toBe("medium")
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

  it("ignores unsupported runtime mode field in config file", async () => {
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

    expect(loaded.mode).toBeUndefined()
    expect(loaded.spoofMode).toBeUndefined()
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

  it("ignores legacy top-level personality/customSettings keys in file config", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const filePath = path.join(root, "codex-config.json")
    await fs.writeFile(
      filePath,
      JSON.stringify({
        personality: "friendly",
        customSettings: {
          thinkingSummaries: true,
          options: { personality: "friendly" }
        }
      }),
      "utf8"
    )

    const loaded = loadConfigFile({ env: { OPENCODE_OPENAI_MULTI_CONFIG_PATH: filePath } })
    expect(loaded.personality).toBeUndefined()
    expect(loaded.behaviorSettings).toBeUndefined()
  })

  it("creates default codex config when missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const result = await ensureDefaultConfigFile({ env: { XDG_CONFIG_HOME: root } })
    const raw = await fs.readFile(result.filePath, "utf8")
    const written = parseConfigJsonWithComments(raw) as unknown

    expect(result.created).toBe(true)
    expect(raw).toContain('// default: "native"')
    expect(raw).toContain('// default: "sticky"')
    expect(raw).toContain("// Thinking summaries behavior:")
    expect(raw).toContain("// Text verbosity behavior:")
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

  it("rejects config file when known fields have invalid types", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const filePath = path.join(root, "codex-config.json")
    await fs.writeFile(
      filePath,
      JSON.stringify({
        quiet: true,
        runtime: {
          rotationStrategy: 123
        }
      }),
      "utf8"
    )

    const loaded = loadConfigFile({ filePath })
    expect(loaded).toEqual({})
  })

  it("warns when codex-config.json cannot be parsed", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const filePath = path.join(root, "codex-config.json")
    await fs.writeFile(filePath, "{ invalid json", "utf8")

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const loaded = loadConfigFile({ filePath })
      expect(loaded).toEqual({})
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to read codex-config"))
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe("config validation", () => {
  it("returns actionable issues for invalid known fields", () => {
    const result = validateConfigFileObject({
      runtime: {
        promptCacheKeyStrategy: "bad"
      }
    })

    expect(result.valid).toBe(false)
    expect(result.issues[0]).toContain("runtime.promptCacheKeyStrategy")
  })
})
