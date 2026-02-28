import { describe, expect, it, vi } from "vitest"

describe("session-affinity runtime state", () => {
  it("resolves affinity file path using provided env", async () => {
    vi.resetModules()

    const defaultSessionAffinityPath = vi.fn(() => "/tmp/custom-session-affinity.json")
    const saveSessionAffinity = vi.fn(async () => ({ version: 1 as const }))

    vi.doMock("../lib/paths", () => ({
      defaultSessionAffinityPath
    }))
    vi.doMock("../lib/session-affinity", () => ({
      createSessionExistsFn: vi.fn(() => async () => true),
      loadSessionAffinity: vi.fn(async () => ({ version: 1 as const })),
      pruneSessionAffinitySnapshot: vi.fn(async () => 0),
      readSessionAffinitySnapshot: vi.fn(() => ({
        seenSessionKeys: new Map<string, number>(),
        stickyBySessionKey: new Map<string, string>(),
        hybridBySessionKey: new Map<string, string>()
      })),
      saveSessionAffinity,
      writeSessionAffinitySnapshot: vi.fn((current: { version: 1 }) => current)
    }))

    const { createSessionAffinityRuntimeState } = await import("../lib/codex-native/session-affinity-state")
    const env = { XDG_CONFIG_HOME: "/tmp/opencode-xdg" } as NodeJS.ProcessEnv

    const runtime = await createSessionAffinityRuntimeState({
      authMode: "native",
      env,
      missingGraceMs: 60_000
    })

    expect(defaultSessionAffinityPath).toHaveBeenCalledWith(env)
    runtime.persistSessionAffinityState()
    await vi.waitFor(() => {
      expect(saveSessionAffinity).toHaveBeenCalledWith(expect.any(Function), "/tmp/custom-session-affinity.json")
    })
  })

  it("logs when session-affinity persistence fails", async () => {
    vi.resetModules()

    const defaultSessionAffinityPath = vi.fn(() => "/tmp/custom-session-affinity.json")
    const saveSessionAffinity = vi.fn(async () => {
      throw new Error("disk write failed")
    })

    vi.doMock("../lib/paths", () => ({
      defaultSessionAffinityPath
    }))
    vi.doMock("../lib/session-affinity", () => ({
      createSessionExistsFn: vi.fn(() => async () => true),
      loadSessionAffinity: vi.fn(async () => ({ version: 1 as const })),
      pruneSessionAffinitySnapshot: vi.fn(async () => 0),
      readSessionAffinitySnapshot: vi.fn(() => ({
        seenSessionKeys: new Map<string, number>(),
        stickyBySessionKey: new Map<string, string>(),
        hybridBySessionKey: new Map<string, string>()
      })),
      saveSessionAffinity,
      writeSessionAffinitySnapshot: vi.fn((current: { version: 1 }) => current)
    }))

    const log = { debug: vi.fn() }
    const { createSessionAffinityRuntimeState } = await import("../lib/codex-native/session-affinity-state")
    const env = { XDG_CONFIG_HOME: "/tmp/opencode-xdg" } as NodeJS.ProcessEnv

    const runtime = await createSessionAffinityRuntimeState({
      authMode: "native",
      env,
      missingGraceMs: 60_000,
      log: log as never
    })

    runtime.persistSessionAffinityState()
    await vi.waitFor(() => {
      expect(log.debug).toHaveBeenCalledWith(
        "session affinity persistence failed",
        expect.objectContaining({ error: "disk write failed" })
      )
    })
  })
})
