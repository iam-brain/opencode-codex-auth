import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  DEFAULT_CODEX_CONFIG,
  ensureDefaultConfigFile,
  loadConfigFile,
  parseConfigJsonWithComments
} from "../lib/config"

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
          orchestratorSubagents: true
        },
        global: {
          reasoningSummaries: true,
          personality: "friendly",
          verbosityEnabled: true,
          verbosity: "high",
          serviceTier: "priority"
        },
        perModel: {
          "gpt-5.3-codex": {
            personality: "pirate",
            reasoningSummaries: false,
            verbosityEnabled: false,
            verbosity: "default",
            serviceTier: "flex",
            variants: {
              high: {
                personality: "strict",
                reasoningSummaries: true,
                verbosityEnabled: true,
                verbosity: "medium",
                serviceTier: "priority"
              }
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
    expect(loaded.rotationStrategy).toBe("hybrid")
    expect(loaded.promptCacheKeyStrategy).toBe("project")
    expect(loaded.mode).toBe("codex")
    expect(loaded.behaviorSettings?.global?.reasoningSummary).toBe("auto")
    expect(loaded.behaviorSettings?.global?.reasoningSummaries).toBe(true)
    expect(loaded.behaviorSettings?.global?.textVerbosity).toBe("high")
    expect(loaded.behaviorSettings?.global?.verbosityEnabled).toBe(true)
    expect(loaded.behaviorSettings?.global?.verbosity).toBe("high")
    expect(loaded.behaviorSettings?.global?.serviceTier).toBe("priority")
    expect(loaded.behaviorSettings?.global?.personality).toBe("friendly")
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.personality).toBe("pirate")
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.reasoningSummary).toBe("none")
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.reasoningSummaries).toBe(false)
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.textVerbosity).toBe("none")
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.verbosityEnabled).toBe(false)
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.verbosity).toBeUndefined()
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.serviceTier).toBe("flex")
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.variants?.high?.personality).toBe("strict")
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.variants?.high?.reasoningSummary).toBe("auto")
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.variants?.high?.reasoningSummaries).toBe(true)
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.variants?.high?.textVerbosity).toBe("medium")
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.variants?.high?.verbosityEnabled).toBe(true)
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.variants?.high?.verbosity).toBe("medium")
    expect(loaded.behaviorSettings?.perModel?.["gpt-5.3-codex"]?.variants?.high?.serviceTier).toBe("priority")
    expect(loaded.personality).toBe("friendly")
  })

  it("loads canonical codex-style model behavior keys", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const filePath = path.join(root, "codex-config.jsonc")
    await fs.writeFile(
      filePath,
      JSON.stringify({
        global: {
          reasoningEffort: "medium",
          reasoningSummary: "concise",
          textVerbosity: "high",
          serviceTier: "auto",
          include: ["file_search_call.results"],
          parallelToolCalls: false
        }
      }),
      "utf8"
    )

    const loaded = loadConfigFile({ filePath })

    expect(loaded.behaviorSettings?.global).toMatchObject({
      reasoningEffort: "medium",
      reasoningSummary: "concise",
      textVerbosity: "high",
      serviceTier: "auto",
      include: ["file_search_call.results"],
      parallelToolCalls: false
    })
  })

  it("loads custom selectable models from codex-config.jsonc", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const filePath = path.join(root, "codex-config.jsonc")
    await fs.writeFile(
      filePath,
      JSON.stringify({
        customModels: {
          "openai/my-fast-codex": {
            targetModel: "gpt-5.3-codex",
            name: "My Fast Codex",
            reasoningSummary: "concise",
            textVerbosity: "medium",
            variants: {
              high: {
                reasoningSummary: "detailed"
              }
            }
          }
        }
      }),
      "utf8"
    )

    const loaded = loadConfigFile({ filePath })

    expect(loaded.customModels?.["openai/my-fast-codex"]).toEqual({
      targetModel: "gpt-5.3-codex",
      name: "My Fast Codex",
      reasoningSummary: "concise",
      reasoningSummaries: true,
      textVerbosity: "medium",
      verbosityEnabled: true,
      verbosity: "medium",
      variants: {
        high: {
          reasoningSummary: "detailed",
          reasoningSummaries: true
        }
      }
    })
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

  it("ignores unsupported runtime mode field in config file and falls back to defaults", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const filePath = path.join(root, "codex-config.json")
    await fs.writeFile(
      filePath,
      JSON.stringify({
        runtime: { mode: "collab" }
      }),
      "utf8"
    )

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const loaded = loadConfigFile({
        env: { OPENCODE_OPENAI_MULTI_CONFIG_PATH: filePath }
      })
      expect(loaded).toEqual({})
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid codex-config"))
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("loads codex-config.jsonc from XDG config home", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const configDir = path.join(root, "opencode")
    await fs.mkdir(configDir, { recursive: true })
    const filePath = path.join(configDir, "codex-config.jsonc")
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
    const written = parseConfigJsonWithComments(raw)

    expect(result.created).toBe(true)
    expect(raw).toContain('// default: "native"')
    expect(raw).toContain('// default: "sticky"')
    expect(raw).toContain('// options: "auto" | "concise" | "detailed" | "none"')
    expect(raw).toContain('// options: "default" | "low" | "medium" | "high" | "none"')
    expect(written).toEqual(DEFAULT_CODEX_CONFIG)
  })

  it("does not overwrite existing codex config by default", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const configDir = path.join(root, "opencode")
    const filePath = path.join(configDir, "codex-config.jsonc")
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
    const filePath = path.join(configDir, "codex-config.jsonc")
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(filePath, JSON.stringify({ debug: true }), "utf8")

    const result = await ensureDefaultConfigFile({
      env: { XDG_CONFIG_HOME: root },
      overwrite: true
    })
    const raw = await fs.readFile(filePath, "utf8")
    const written = parseConfigJsonWithComments(raw)

    expect(result.created).toBe(true)
    expect(raw).toContain("// Optional model-specific overrides.")
    expect(written).toEqual(DEFAULT_CODEX_CONFIG)
  })

  it("enforces 0600 mode when overwriting codex config", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const configDir = path.join(root, "opencode")
    const filePath = path.join(configDir, "codex-config.jsonc")
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(filePath, JSON.stringify({ debug: true }), { encoding: "utf8", mode: 0o644 })
    await fs.chmod(filePath, 0o644)

    await ensureDefaultConfigFile({
      env: { XDG_CONFIG_HOME: root },
      overwrite: true
    })

    const mode = (await fs.stat(filePath)).mode & 0o777
    if (process.platform !== "win32") {
      expect(mode).toBe(0o600)
    }
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

  it("warns and maps deprecated thinkingSummaries keys to reasoningSummaries", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const filePath = path.join(root, "codex-config.json")
    await fs.writeFile(
      filePath,
      JSON.stringify({
        global: {
          thinkingSummaries: true
        }
      }),
      "utf8"
    )

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const loaded = loadConfigFile({ filePath })
      expect(loaded.behaviorSettings?.global?.reasoningSummary).toBe("auto")
      expect(loaded.behaviorSettings?.global?.reasoningSummaries).toBe(true)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Deprecated config key(s)"))
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("global.thinkingSummaries"))
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("loads legacy codex-config.json when canonical codex-config.jsonc is absent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const configDir = path.join(root, "opencode")
    const legacyPath = path.join(configDir, "codex-config.json")
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(legacyPath, JSON.stringify({ quiet: true }), "utf8")

    const loaded = loadConfigFile({ env: { XDG_CONFIG_HOME: root } })
    expect(loaded.quietMode).toBe(true)
  })

  it("quarantines legacy codex-config.json when both config files exist", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const configDir = path.join(root, "opencode")
    const canonicalPath = path.join(configDir, "codex-config.jsonc")
    const legacyPath = path.join(configDir, "codex-config.json")
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(canonicalPath, JSON.stringify({ quiet: true }), "utf8")
    await fs.writeFile(legacyPath, JSON.stringify({ quiet: false }), "utf8")

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const loaded = loadConfigFile({ env: { XDG_CONFIG_HOME: root } })
      expect(loaded.quietMode).toBe(true)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Found both codex-config.jsonc and codex-config.json")
      )
      await expect(fs.access(legacyPath)).rejects.toThrow()
      const quarantineDir = path.join(configDir, "quarantine")
      const quarantined = await fs.readdir(quarantineDir)
      expect(quarantined.some((name) => name.startsWith("codex-config.json."))).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("falls back to legacy codex-config.json when canonical codex-config.jsonc is invalid", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-config-file-"))
    const configDir = path.join(root, "opencode")
    const canonicalPath = path.join(configDir, "codex-config.jsonc")
    const legacyPath = path.join(configDir, "codex-config.json")
    await fs.mkdir(configDir, { recursive: true })
    await fs.writeFile(canonicalPath, '{"quiet": true,', "utf8")
    await fs.writeFile(legacyPath, JSON.stringify({ quiet: false }), "utf8")

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const loaded = loadConfigFile({ env: { XDG_CONFIG_HOME: root } })
      expect(loaded.quietMode).toBe(false)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`Failed to read codex-config at ${canonicalPath}`))
      await expect(fs.access(legacyPath)).resolves.toBeUndefined()
      await expect(fs.access(path.join(configDir, "quarantine"))).rejects.toThrow()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("ignores config file when known fields have invalid types", async () => {
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

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const loaded = loadConfigFile({ filePath })
      expect(loaded).toEqual({})
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid codex-config"))
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("warns and falls back when codex-config.json cannot be parsed", async () => {
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
