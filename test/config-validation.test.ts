import { describe, expect, it } from "vitest"

import {
  parseConfigFileObject,
  resolveDefaultConfigPath,
  resolveLegacyDefaultConfigPath,
  validateConfigFileObject
} from "../lib/config"

describe("config validation", () => {
  it("returns actionable issues for invalid known fields", () => {
    const result = validateConfigFileObject({
      runtime: {
        promptCacheKeyStrategy: "bad"
      },
      global: {
        serviceTier: "turbo"
      }
    })

    expect(result.valid).toBe(false)
    expect(result.issues[0]).toContain("runtime.promptCacheKeyStrategy")
    expect(result.issues[1]).toContain("global.serviceTier")
  })

  it("reports precise custom model validation issues", () => {
    const result = validateConfigFileObject({
      customModels: {
        "openai/my-fast-codex": {
          targetModel: 42,
          name: false,
          include: ["bad_include"],
          parallelToolCalls: "yes",
          variants: []
        }
      }
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("customModels.openai/my-fast-codex.targetModel"),
        expect.stringContaining("customModels.openai/my-fast-codex.name"),
        expect.stringContaining("customModels.openai/my-fast-codex.include"),
        expect.stringContaining("customModels.openai/my-fast-codex.parallelToolCalls"),
        expect.stringContaining("customModels.openai/my-fast-codex.variants")
      ])
    )
  })

  it("normalizes canonical config fields and custom model aliases", () => {
    const parsed = parseConfigFileObject({
      global: {
        textVerbosity: "HIGH",
        serviceTier: "default",
        include: ["FILE_SEARCH_CALL.RESULTS", "bad"],
        parallelToolCalls: false
      },
      customModels: {
        " OpenAI/My-Fast-Codex ": {
          targetModel: " gpt-5.3-codex ",
          thinkingSummaries: false,
          verbosityEnabled: true,
          verbosity: "medium",
          serviceTier: "default",
          include: ["MESSAGE.OUTPUT_TEXT.LOGPROBS", "bad"],
          parallelToolCalls: true,
          variants: {
            high: {
              reasoningSummaries: true,
              verbosityEnabled: false
            }
          }
        }
      }
    })

    expect(parsed.behaviorSettings?.global).toEqual({
      textVerbosity: "high",
      verbosityEnabled: true,
      verbosity: "high",
      serviceTier: "auto",
      include: ["file_search_call.results"],
      parallelToolCalls: false
    })
    expect(parsed.customModels?.["openai/my-fast-codex"]).toEqual({
      targetModel: "gpt-5.3-codex",
      reasoningSummary: "none",
      reasoningSummaries: false,
      textVerbosity: "medium",
      verbosityEnabled: true,
      verbosity: "medium",
      serviceTier: "auto",
      include: ["message.output_text.logprobs"],
      parallelToolCalls: true,
      variants: {
        high: {
          reasoningSummary: "auto",
          reasoningSummaries: true,
          textVerbosity: "none",
          verbosityEnabled: false
        }
      }
    })
  })

  it("resolves canonical and legacy config paths from XDG config home", () => {
    expect(resolveDefaultConfigPath({ XDG_CONFIG_HOME: "/tmp/config-root" })).toBe(
      "/tmp/config-root/opencode/codex-config.jsonc"
    )
    expect(resolveLegacyDefaultConfigPath({ XDG_CONFIG_HOME: "/tmp/config-root" })).toBe(
      "/tmp/config-root/opencode/codex-config.json"
    )
  })
})
