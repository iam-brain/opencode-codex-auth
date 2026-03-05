import { describe, expect, it } from "vitest"

import {
  getBehaviorSettings,
  getCollaborationProfileEnabled,
  getCodexCompactionOverrideEnabled,
  getCompatInputSanitizerEnabled,
  getDebugEnabled,
  getHeaderSnapshotBodiesEnabled,
  getHeaderSnapshotsEnabled,
  getHeaderTransformDebugEnabled,
  getMode,
  getOrchestratorSubagentsEnabled,
  getPersonality,
  getPidOffsetEnabled,
  getPromptCacheKeyStrategy,
  getQuietMode,
  getRemapDeveloperMessagesToUserEnabled,
  getRotationStrategy,
  getSpoofMode,
  getThinkingSummariesOverride,
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

  it("keeps file runtime mode authoritative over spoof env compatibility input", () => {
    const cfg = resolveConfig({
      env: { OPENCODE_OPENAI_MULTI_SPOOF_MODE: "codex" },
      file: { mode: "native" }
    })
    expect(getMode(cfg)).toBe("native")
    expect(getSpoofMode(cfg)).toBe("native")
  })

  it("uses spoof env only when runtime mode is unset", () => {
    const cfg = resolveConfig({
      env: { OPENCODE_OPENAI_MULTI_SPOOF_MODE: "codex" },
      file: {}
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

  it("parses service tier override from env", () => {
    const cfg = resolveConfig({
      env: {
        OPENCODE_OPENAI_MULTI_SERVICE_TIER: "priority"
      }
    })

    expect(getBehaviorSettings(cfg)?.global?.serviceTier).toBe("priority")
  })

  it("lets env service tier override file behavior settings", () => {
    const cfg = resolveConfig({
      env: {
        OPENCODE_OPENAI_MULTI_SERVICE_TIER: "priority"
      },
      file: {
        behaviorSettings: {
          global: {
            serviceTier: "flex"
          }
        }
      }
    })

    expect(getBehaviorSettings(cfg)?.global?.serviceTier).toBe("priority")
  })

  it("keeps per-model and variant service tier overrides from file config", () => {
    const cfg = resolveConfig({
      env: {},
      file: {
        behaviorSettings: {
          perModel: {
            "gpt-5.4": {
              serviceTier: "priority",
              variants: {
                high: {
                  serviceTier: "flex"
                }
              }
            }
          }
        }
      }
    })

    expect(getBehaviorSettings(cfg)?.perModel?.["gpt-5.4"]?.serviceTier).toBe("priority")
    expect(getBehaviorSettings(cfg)?.perModel?.["gpt-5.4"]?.variants?.high?.serviceTier).toBe("flex")
  })
})
