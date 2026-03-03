import { describe, expect, it } from "vitest"

import { applyCodexCatalogToProviderModels, getRuntimeDefaultsForSlug } from "../lib/model-catalog"

describe("model catalog provider model mapping", () => {
  it("extracts runtime defaults and applies them to provider models", () => {
    const providerModels: Record<string, Record<string, unknown>> = {
      "gpt-5.2-codex": { id: "gpt-5.2-codex", instructions: "old" },
      "o3-mini": { id: "o3-mini" }
    }

    const catalogModels = [
      {
        slug: "gpt-5.4-codex",
        apply_patch_tool_type: "apply_patch",
        default_reasoning_level: "medium",
        supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
        supports_reasoning_summaries: true,
        reasoning_summary_format: "experimental",
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
    expect(providerModels["gpt-5.4-codex"].name).toBe("GPT-5.4 Codex")
    expect(providerModels["gpt-5.4-codex"].displayName).toBe("GPT-5.4 Codex")
    expect(providerModels["o3-mini"]).toBeUndefined()
    expect(providerModels["gpt-5.4-codex"].codexRuntimeDefaults).toEqual({
      applyPatchToolType: "apply_patch",
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high"],
      supportsReasoningSummaries: true,
      reasoningSummaryFormat: "experimental",
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

  it("orders provider models in reverse alphabetical slug order", () => {
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
})
