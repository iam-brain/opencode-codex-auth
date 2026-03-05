import { describe, expect, it } from "vitest"

import {
  applyCodexCatalogToProviderModels,
  getRuntimeDefaultsForSlug,
  parseCatalogResponse
} from "../lib/model-catalog"

describe("model catalog provider model mapping", () => {
  it("parses live catalog display metadata used by runtime shaping", () => {
    const parsed = parseCatalogResponse({
      models: [
        {
          slug: "gpt-5.4",
          display_name: "gpt-5.4",
          priority: 0,
          supports_parallel_tool_calls: true
        }
      ]
    })

    expect(parsed).toEqual([
      {
        slug: "gpt-5.4",
        display_name: "gpt-5.4",
        priority: 0,
        model_messages: null,
        base_instructions: null,
        apply_patch_tool_type: null,
        supported_reasoning_levels: null,
        default_reasoning_level: null,
        supports_reasoning_summaries: null,
        reasoning_summary_format: null,
        supports_parallel_tool_calls: true,
        support_verbosity: null,
        default_verbosity: null
      }
    ])
  })

  it("extracts runtime defaults and applies them to provider models", () => {
    const providerModels: Record<string, Record<string, unknown>> = {
      "gpt-5.2-codex": { id: "gpt-5.2-codex", instructions: "old" },
      "o3-mini": { id: "o3-mini" }
    }

    const catalogModels = [
      {
        slug: "gpt-5.4-codex",
        display_name: "GPT-5.4 Frontier",
        apply_patch_tool_type: "apply_patch",
        default_reasoning_level: "medium",
        supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
        supports_reasoning_summaries: true,
        reasoning_summary_format: "experimental",
        supports_parallel_tool_calls: false,
        support_verbosity: true,
        default_verbosity: "high",
        model_messages: {
          instructions_template: "Base {{ personality }}",
          instructions_variables: { personality_default: "Default" }
        }
      }
    ]

    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels,
      fallbackModels: ["gpt-5.2-codex"]
    })

    expect(providerModels["gpt-5.4-codex"]).toBeDefined()
    expect(providerModels["gpt-5.4-codex"].instructions).toBe("Base Default")
    expect(providerModels["gpt-5.4-codex"].name).toBe("GPT-5.4 Frontier")
    expect(providerModels["gpt-5.4-codex"].displayName).toBe("GPT-5.4 Frontier")
    expect(providerModels["o3-mini"]).toBeUndefined()
    expect(providerModels["gpt-5.4-codex"].codexRuntimeDefaults).toEqual({
      applyPatchToolType: "apply_patch",
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high"],
      supportsReasoningSummaries: true,
      reasoningSummaryFormat: "experimental",
      supportsParallelToolCalls: false,
      supportsVerbosity: true,
      defaultVerbosity: "high"
    })

    const defaults = getRuntimeDefaultsForSlug("gpt-5.4-codex-high", catalogModels)
    expect(defaults?.defaultReasoningEffort).toBe("medium")
  })

  it("normalizes slug-style model names into title-cased display names", () => {
    const providerModels: Record<string, Record<string, unknown>> = {
      "gpt-5.2-codex": { id: "gpt-5.2-codex" }
    }

    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels: [{ slug: "gpt-5.1-codex-mini" }],
      fallbackModels: []
    })

    expect(providerModels["gpt-5.1-codex-mini"]).toBeDefined()
    expect(providerModels["gpt-5.1-codex-mini"].name).toBe("GPT-5.1 Codex Mini")
    expect(providerModels["gpt-5.1-codex-mini"].displayName).toBe("GPT-5.1 Codex Mini")
  })

  it("orders provider models by catalog priority before slug fallback", () => {
    const providerModels: Record<string, Record<string, unknown>> = {
      "gpt-5.2-codex": { id: "gpt-5.2-codex" },
      "gpt-5.1-codex-mini": { id: "gpt-5.1-codex-mini" },
      "gpt-5.3-codex": { id: "gpt-5.3-codex" }
    }

    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels: [
        { slug: "gpt-5.2-codex", priority: 3 },
        { slug: "gpt-5.1-codex-mini", priority: 12 },
        { slug: "gpt-5.3-codex", priority: 0 }
      ],
      fallbackModels: []
    })

    expect(Object.keys(providerModels)).toEqual(["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex-mini"])
  })

  it("keeps newer-first fallback ordering when catalog priorities are absent", () => {
    const providerModels: Record<string, Record<string, unknown>> = {
      "gpt-5.2-codex": { id: "gpt-5.2-codex" },
      "gpt-5.1-codex-mini": { id: "gpt-5.1-codex-mini" },
      "gpt-5.3-codex": { id: "gpt-5.3-codex" }
    }

    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels: [{ slug: "gpt-5.2-codex" }, { slug: "gpt-5.1-codex-mini" }, { slug: "gpt-5.3-codex" }],
      fallbackModels: []
    })

    expect(Object.keys(providerModels)).toEqual(["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex-mini"])
  })

  it("keeps GPT-5.4 from the OpenCode baseline surface when no live catalog is available", () => {
    const providerModels: Record<string, Record<string, unknown>> = {
      "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4" },
      "gpt-5.3-codex": { id: "gpt-5.3-codex" },
      "o3-mini": { id: "o3-mini" }
    }

    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels: undefined,
      fallbackModels: ["gpt-5.3-codex"]
    })

    expect(providerModels["gpt-5.4"]).toBeDefined()
    expect(providerModels["gpt-5.3-codex"]).toBeDefined()
    expect(providerModels["o3-mini"]).toBeUndefined()
  })
})
