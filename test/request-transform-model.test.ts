import { describe, expect, it } from "vitest"

import type { CustomModelConfig } from "../lib/config.js"
import type { CodexModelInfo } from "../lib/model-catalog.js"
import {
  applyResolvedCodexRuntimeDefaults,
  findCatalogModelForCandidates,
  getConfiguredCustomModelReasoningSummaryOverride,
  getCustomModelIncludeOverride,
  getCustomModelParallelToolCallsOverride,
  getCustomModelReasoningEffortOverride,
  getCustomModelTextVerbosityOverride,
  getModelLookupCandidates,
  getSelectedModelLookupCandidates,
  getVariantLookupCandidates
} from "../lib/codex-native/request-transform-model.js"

describe("request transform model helpers", () => {
  it("builds model and variant lookup candidates from ids and slash tails", () => {
    expect(
      getModelLookupCandidates({
        id: "openai/my-fast-codex-high",
        api: { id: "gpt-5.3-codex-high" }
      })
    ).toEqual(["openai/my-fast-codex-high", "gpt-5.3-codex-high", "my-fast-codex-high"])

    expect(getSelectedModelLookupCandidates({ id: "openai/my-fast-codex-high" })).toEqual([
      "openai/my-fast-codex-high",
      "my-fast-codex-high"
    ])

    expect(
      getVariantLookupCandidates({
        message: { variant: "high" },
        modelCandidates: ["openai/my-fast-codex/high", "gpt-5.3-codex-high"]
      })
    ).toEqual(["high"])
  })

  it("matches catalog and configured custom models with case-insensitive effort fallback", () => {
    const customModels: Record<string, CustomModelConfig> = {
      "OpenAI/My-Fast-Codex": {
        targetModel: "gpt-5.3-codex",
        reasoningSummaries: false,
        variants: {
          HIGH: {
            reasoningSummary: "detailed"
          }
        }
      }
    }

    expect(
      getConfiguredCustomModelReasoningSummaryOverride(customModels, ["openai/my-fast-codex-high"], ["high"])
    ).toBe("detailed")
    expect(getConfiguredCustomModelReasoningSummaryOverride(customModels, ["openai/my-fast-codex-high"], [])).toBe(
      "none"
    )

    const catalogModels: CodexModelInfo[] = [
      {
        slug: "gpt-5.3-codex",
        context_window: 272000,
        supported_reasoning_levels: [{ effort: "high" }],
        input_modalities: ["text"]
      }
    ]
    expect(findCatalogModelForCandidates(catalogModels, ["gpt-5.3-codex-high"])?.slug).toBe("gpt-5.3-codex")
  })

  it("reads custom model overrides from codexCustomModelConfig model options", () => {
    const modelOptions = {
      codexCustomModelConfig: {
        targetModel: "gpt-5.3-codex",
        reasoningEffort: "high",
        textVerbosity: "HIGH",
        include: ["file_search_call.results"],
        parallelToolCalls: false
      }
    }

    expect(getCustomModelReasoningEffortOverride(modelOptions, [])).toBe("high")
    expect(getCustomModelTextVerbosityOverride(modelOptions, [])).toBe("high")
    expect(getCustomModelIncludeOverride(modelOptions, [])).toEqual(["file_search_call.results"])
    expect(getCustomModelParallelToolCallsOverride(modelOptions, [])).toBe(false)
  })

  it("applies resolved defaults, dedupes includes, and strips unsupported explicit verbosity", () => {
    const options: Record<string, unknown> = {
      textVerbosity: "LOUD",
      include: ["file_search_call.results"],
      reasoningEffort: "high"
    }

    applyResolvedCodexRuntimeDefaults({
      options,
      codexInstructions: "Catalog instructions",
      defaults: {
        applyPatchToolType: "apply_patch",
        supportsReasoningSummaries: true,
        reasoningSummaryFormat: "auto",
        supportsParallelToolCalls: true,
        defaultVerbosity: "low",
        supportsVerbosity: true
      },
      modelToolCallCapable: true,
      resolvedBehavior: {
        reasoningSummary: "concise",
        textVerbosity: "default",
        include: ["reasoning.encrypted_content"],
        parallelToolCalls: false
      },
      modelId: "gpt-5.3-codex",
      preferCodexInstructions: false
    })

    expect(options.instructions).toBe("Catalog instructions")
    expect(options.reasoningSummary).toBe("concise")
    expect(options.textVerbosity).toBe("low")
    expect(options.applyPatchToolType).toBe("apply_patch")
    expect(options.parallelToolCalls).toBe(false)
    expect(options.include).toEqual(["file_search_call.results", "reasoning.encrypted_content"])
  })
})
