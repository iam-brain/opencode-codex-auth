import os from "node:os"
import process from "node:process"

import { describe, expect, it, vi } from "vitest"
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

  it("keeps native mode UA in opencode format and codex mode as codex-style", () => {
    const nativeUa = __testOnly.resolveRequestUserAgent("native", "opencode")
    const codexUa = __testOnly.resolveRequestUserAgent("codex", "codex_cli_rs")
    expect(nativeUa).toMatch(/^opencode\/\d+\.\d+\.\d+/)
    expect(codexUa).toMatch(/^codex_cli_rs\//)
  })

  it("keeps opencode formatting when codex mode resolves the opencode originator", () => {
    const ua = __testOnly.resolveRequestUserAgent("codex", "opencode")
    expect(ua).toMatch(/^opencode\/\d+\.\d+\.\d+/)
    expect(ua).not.toContain("codex_cli_rs")
  })

  it("sanitizes non-ascii terminal metadata and keeps UA printable", async () => {
    vi.resetModules()
    const originalTermProgram = process.env.TERM_PROGRAM
    const originalTermProgramVersion = process.env.TERM_PROGRAM_VERSION
    try {
      process.env.TERM_PROGRAM = "终端✓"
      process.env.TERM_PROGRAM_VERSION = "版本-β"
      const identity = await import("../lib/codex-native/client-identity")
      const ua = identity.buildCodexUserAgent("codex_cli_rs")
      expect(ua.startsWith("codex_cli_rs/")).toBe(true)
      expect(/^[\x20-\x7E]+$/.test(ua)).toBe(true)
    } finally {
      if (originalTermProgram === undefined) delete process.env.TERM_PROGRAM
      else process.env.TERM_PROGRAM = originalTermProgram
      if (originalTermProgramVersion === undefined) delete process.env.TERM_PROGRAM_VERSION
      else process.env.TERM_PROGRAM_VERSION = originalTermProgramVersion
    }
  })

  it("falls back terminal token to unknown when terminal env is absent", async () => {
    vi.resetModules()
    const saved: Record<string, string | undefined> = {
      TERM_PROGRAM: process.env.TERM_PROGRAM,
      TERM_PROGRAM_VERSION: process.env.TERM_PROGRAM_VERSION,
      TERM: process.env.TERM,
      WEZTERM_VERSION: process.env.WEZTERM_VERSION,
      TMUX: process.env.TMUX,
      TMUX_PANE: process.env.TMUX_PANE,
      ITERM_SESSION_ID: process.env.ITERM_SESSION_ID,
      ITERM_PROFILE: process.env.ITERM_PROFILE,
      ITERM_PROFILE_NAME: process.env.ITERM_PROFILE_NAME,
      TERM_SESSION_ID: process.env.TERM_SESSION_ID,
      KITTY_WINDOW_ID: process.env.KITTY_WINDOW_ID,
      ALACRITTY_SOCKET: process.env.ALACRITTY_SOCKET,
      KONSOLE_VERSION: process.env.KONSOLE_VERSION,
      GNOME_TERMINAL_SCREEN: process.env.GNOME_TERMINAL_SCREEN,
      VTE_VERSION: process.env.VTE_VERSION,
      WT_SESSION: process.env.WT_SESSION
    }
    try {
      for (const key of Object.keys(saved)) {
        delete process.env[key]
      }
      const identity = await import("../lib/codex-native/client-identity")
      const ua = identity.buildCodexUserAgent("codex_exec")
      expect(ua.startsWith("codex_exec/")).toBe(true)
      expect(ua.endsWith(" unknown")).toBe(true)
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it("falls back from tmux probing to the TERM_PROGRAM token when tmux metadata is unavailable", async () => {
    vi.resetModules()
    const saved = {
      TERM_PROGRAM: process.env.TERM_PROGRAM,
      TERM_PROGRAM_VERSION: process.env.TERM_PROGRAM_VERSION,
      TMUX: process.env.TMUX,
      TMUX_PANE: process.env.TMUX_PANE
    }
    try {
      process.env.TERM_PROGRAM = "tmux"
      process.env.TERM_PROGRAM_VERSION = "3.4"
      process.env.TMUX = "/tmp/tmux-session"
      delete process.env.TMUX_PANE
      const identity = await import("../lib/codex-native/client-identity")
      const ua = identity.buildCodexUserAgent("codex_cli_rs")
      expect(ua.endsWith(" tmux/3.4")).toBe(true)
    } finally {
      if (saved.TERM_PROGRAM === undefined) delete process.env.TERM_PROGRAM
      else process.env.TERM_PROGRAM = saved.TERM_PROGRAM
      if (saved.TERM_PROGRAM_VERSION === undefined) delete process.env.TERM_PROGRAM_VERSION
      else process.env.TERM_PROGRAM_VERSION = saved.TERM_PROGRAM_VERSION
      if (saved.TMUX === undefined) delete process.env.TMUX
      else process.env.TMUX = saved.TMUX
      if (saved.TMUX_PANE === undefined) delete process.env.TMUX_PANE
      else process.env.TMUX_PANE = saved.TMUX_PANE
    }
  })

  it("formats Windows platform signatures with normalized x64 architecture", async () => {
    vi.resetModules()
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")
    const originalTermProgram = process.env.TERM_PROGRAM
    const originalTermProgramVersion = process.env.TERM_PROGRAM_VERSION
    const archSpy = vi.spyOn(os, "arch").mockReturnValue("x64")
    const releaseSpy = vi.spyOn(os, "release").mockReturnValue("10.0.22631")
    try {
      Object.defineProperty(process, "platform", { configurable: true, value: "win32" })
      process.env.TERM_PROGRAM = "Windows Terminal"
      process.env.TERM_PROGRAM_VERSION = "1.20"
      const identity = await import("../lib/codex-native/client-identity")
      const ua = identity.buildCodexUserAgent("codex_exec")
      expect(ua).toContain("(Windows 10.0.22631; x86_64)")
      expect(ua.endsWith(" Windows_Terminal/1.20")).toBe(true)
    } finally {
      archSpy.mockRestore()
      releaseSpy.mockRestore()
      if (originalPlatform) {
        Object.defineProperty(process, "platform", originalPlatform)
      }
      if (originalTermProgram === undefined) delete process.env.TERM_PROGRAM
      else process.env.TERM_PROGRAM = originalTermProgram
      if (originalTermProgramVersion === undefined) delete process.env.TERM_PROGRAM_VERSION
      else process.env.TERM_PROGRAM_VERSION = originalTermProgramVersion
    }
  })

  it("falls back unknown architecture and platform labels when runtime values are empty", async () => {
    vi.resetModules()
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")
    const originalTerm = process.env.TERM
    const archSpy = vi.spyOn(os, "arch").mockReturnValue("")
    const releaseSpy = vi.spyOn(os, "release").mockReturnValue("5.11")
    try {
      Object.defineProperty(process, "platform", { configurable: true, value: "sunos" })
      process.env.TERM = "vt100"
      const identity = await import("../lib/codex-native/client-identity")
      const ua = identity.buildCodexUserAgent("codex_exec")
      expect(ua).toContain("(sunos 5.11; unknown)")
      expect(ua.endsWith(" vt100")).toBe(true)
    } finally {
      archSpy.mockRestore()
      releaseSpy.mockRestore()
      if (originalPlatform) {
        Object.defineProperty(process, "platform", originalPlatform)
      }
      if (originalTerm === undefined) delete process.env.TERM
      else process.env.TERM = originalTerm
    }
  })
})
