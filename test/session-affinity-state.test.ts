import type { Logger } from "../lib/logger"
import { createSessionAffinityRuntimeState } from "../lib/codex-native/session-affinity-state"
import { describe, expect, it, vi } from "vitest"

function createLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}

describe("session-affinity runtime state", () => {
  it("resolves affinity file path using provided env", async () => {
    const defaultSessionAffinityPath = vi.fn(() => "/tmp/custom-session-affinity.json")
    const saveSessionAffinity = vi.fn(async () => ({ version: 1 as const }))
    const env = { XDG_CONFIG_HOME: "/tmp/opencode-xdg" } as NodeJS.ProcessEnv

    const runtime = await createSessionAffinityRuntimeState({
      authMode: "native",
      env,
      missingGraceMs: 60_000,
      deps: {
        defaultSessionAffinityPath,
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
      }
    })

    expect(defaultSessionAffinityPath).toHaveBeenCalledWith(env)
    await runtime.persistSessionAffinityState()
    await vi.waitFor(() => {
      expect(saveSessionAffinity).toHaveBeenCalledWith(expect.any(Function), "/tmp/custom-session-affinity.json")
    })
  })

  it("logs when session-affinity persistence fails", async () => {
    const defaultSessionAffinityPath = vi.fn(() => "/tmp/custom-session-affinity.json")
    const saveSessionAffinity = vi.fn(async () => {
      throw new Error("disk write failed")
    })
    const log = createLogger()
    const env = { XDG_CONFIG_HOME: "/tmp/opencode-xdg" } as NodeJS.ProcessEnv

    const runtime = await createSessionAffinityRuntimeState({
      authMode: "native",
      env,
      missingGraceMs: 60_000,
      log,
      deps: {
        defaultSessionAffinityPath,
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
      }
    })

    await runtime.persistSessionAffinityState()
    await vi.waitFor(() => {
      expect(log.debug).toHaveBeenCalledWith(
        "session affinity persistence failed",
        expect.objectContaining({ error: "disk write failed" })
      )
    })
  })
})
