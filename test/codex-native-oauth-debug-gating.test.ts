import { afterEach, describe, expect, it } from "vitest"

import { __testOnly } from "../lib/codex-native"

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
})
