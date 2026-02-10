import { describe, expect, it } from "vitest"
import { __testOnly } from "../lib/codex-native"

describe("codex-native user-agent parity", () => {
  it("builds codex-style user-agent format for codex_cli_rs", () => {
    const ua = __testOnly.buildCodexUserAgent("codex_cli_rs")
    expect(ua).toMatch(/^codex_cli_rs\/\d+\.\d+\.\d+/)
    expect(ua).toContain(" (")
    expect(ua).toContain("; ")
  })

  it("builds codex-style user-agent format for codex_exec", () => {
    const ua = __testOnly.buildCodexUserAgent("codex_exec")
    expect(ua).toMatch(/^codex_exec\/\d+\.\d+\.\d+/)
  })

  it("keeps native mode UA as plugin-native and codex mode as codex-style", () => {
    const nativeUa = __testOnly.resolveRequestUserAgent("native", "codex_cli_rs")
    const codexUa = __testOnly.resolveRequestUserAgent("codex", "codex_cli_rs")
    expect(nativeUa).toContain("opencode-codex-auth")
    expect(codexUa).toMatch(/^codex_cli_rs\//)
  })
})
