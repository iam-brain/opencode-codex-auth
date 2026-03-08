import { describe, expect, it } from "vitest"

import {
  buildResolvedBehaviorSettings,
  cloneBehaviorSettings,
  getCollaborationProfileEnabled,
  getCodexCompactionOverrideEnabled,
  getCompatInputSanitizerEnabled,
  getOrchestratorSubagentsEnabled,
  getProactiveRefreshBufferMs,
  getProactiveRefreshEnabled,
  getRemapDeveloperMessagesToUserEnabled,
  resolveConfig
} from "../lib/config"

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

  it("treats blank proactive refresh buffer env as unset", () => {
    const cfg = resolveConfig({
      env: { OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH_BUFFER_MS: "   " }
    })
    expect(getProactiveRefreshBufferMs(cfg)).toBe(60_000)
  })

  it("keeps behavior helpers on the top-level config export surface", () => {
    const fileBehavior = {
      global: {
        personality: "balanced",
        reasoningSummaries: false
      }
    } as const

    const cloned = cloneBehaviorSettings(fileBehavior)
    expect(cloned).toEqual(fileBehavior)
    expect(cloned).not.toBe(fileBehavior)

    expect(
      buildResolvedBehaviorSettings({
        fileBehavior,
        envPersonality: "concise",
        envReasoningSummaries: undefined,
        envVerbosityEnabled: undefined,
        envVerbosity: undefined,
        envServiceTier: undefined
      })
    ).toEqual({
      global: {
        personality: "concise",
        reasoningSummaries: false
      }
    })
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
