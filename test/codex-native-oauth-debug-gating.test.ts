import { afterEach, describe, expect, it } from "vitest"
import os from "node:os"
import path from "node:path"

import { createOAuthServerController } from "../lib/codex-native/oauth-server"

import { __testOnly } from "../lib/codex-native"
import { opencodeProviderAuthPath } from "../lib/paths"

const ORIGINAL_CODEX_AUTH_DEBUG = process.env.CODEX_AUTH_DEBUG
const ORIGINAL_PLUGIN_DEBUG = process.env.OPENCODE_OPENAI_MULTI_DEBUG
const ORIGINAL_ALT_DEBUG = process.env.DEBUG_CODEX_PLUGIN

describe("codex-native oauth debug gating", () => {
  afterEach(() => {
    if (ORIGINAL_CODEX_AUTH_DEBUG === undefined) {
      delete process.env.CODEX_AUTH_DEBUG
    } else {
      process.env.CODEX_AUTH_DEBUG = ORIGINAL_CODEX_AUTH_DEBUG
    }
    if (ORIGINAL_PLUGIN_DEBUG === undefined) {
      delete process.env.OPENCODE_OPENAI_MULTI_DEBUG
    } else {
      process.env.OPENCODE_OPENAI_MULTI_DEBUG = ORIGINAL_PLUGIN_DEBUG
    }
    if (ORIGINAL_ALT_DEBUG === undefined) {
      delete process.env.DEBUG_CODEX_PLUGIN
    } else {
      process.env.DEBUG_CODEX_PLUGIN = ORIGINAL_ALT_DEBUG
    }
  })

  it("enables oauth lifecycle logging only when CODEX_AUTH_DEBUG is explicitly truthy", () => {
    delete process.env.CODEX_AUTH_DEBUG
    process.env.OPENCODE_OPENAI_MULTI_DEBUG = "1"
    process.env.DEBUG_CODEX_PLUGIN = "1"
    expect(__testOnly.isOAuthDebugEnabled()).toBe(false)

    process.env.CODEX_AUTH_DEBUG = "0"
    expect(__testOnly.isOAuthDebugEnabled()).toBe(false)

    process.env.CODEX_AUTH_DEBUG = "1"
    expect(__testOnly.isOAuthDebugEnabled()).toBe(true)

    process.env.CODEX_AUTH_DEBUG = "true"
    expect(__testOnly.isOAuthDebugEnabled()).toBe(true)

    process.env.CODEX_AUTH_DEBUG = "on"
    expect(__testOnly.isOAuthDebugEnabled()).toBe(true)
  })

  it("resolves provider auth marker path via XDG_DATA_HOME", () => {
    const previousXdgData = process.env.XDG_DATA_HOME
    const xdgRoot = path.join(os.tmpdir(), "xdg-data-root")
    process.env.XDG_DATA_HOME = xdgRoot
    try {
      expect(opencodeProviderAuthPath()).toBe(path.join(xdgRoot, "opencode", "auth.json"))
    } finally {
      if (previousXdgData === undefined) {
        delete process.env.XDG_DATA_HOME
      } else {
        process.env.XDG_DATA_HOME = previousXdgData
      }
    }
  })

  it("nests oauth debug metadata under meta field", () => {
    const previousDebug = process.env.CODEX_AUTH_DEBUG
    process.env.CODEX_AUTH_DEBUG = "1"

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      const controller = createOAuthServerController({
        port: 1455,
        loopbackHost: "localhost",
        callbackOrigin: "http://localhost:1455",
        callbackUri: "http://localhost:1455/auth/callback",
        callbackPath: "/auth/callback",
        callbackTimeoutMs: 60_000,
        buildOAuthErrorHtml: (error: string) => error,
        buildOAuthSuccessHtml: () => "ok",
        composeCodexSuccessRedirectUrl: () => "http://localhost:1455/success",
        exchangeCodeForTokens: async () => ({ access_token: "a", refresh_token: "r" })
      })

      controller.emitDebug("test_event", { event: "attempted_override", access_token: "sensitive" })

      const combined = String(consoleErrorSpy.mock.calls[0]?.[0] ?? "")
      const jsonStart = combined.indexOf("{")
      expect(jsonStart).toBeGreaterThanOrEqual(0)
      const payload = JSON.parse(combined.slice(jsonStart)) as {
        event: string
        meta?: Record<string, unknown>
      }

      expect(payload.event).toBe("test_event")
      expect(payload.meta?.event).toBe("attempted_override")
      expect(payload.meta?.access_token).toBe("[redacted]")
    } finally {
      consoleErrorSpy.mockRestore()
      if (previousDebug === undefined) {
        delete process.env.CODEX_AUTH_DEBUG
      } else {
        process.env.CODEX_AUTH_DEBUG = previousDebug
      }
    }
  })
})
