import { readFile } from "node:fs/promises"

import { describe, expect, it, vi } from "vitest"

import {
  applyCodexCatalogToProviderModels,
  applyGeneratedAliasesToProviderModels,
  getRuntimeDefaultsForSlug,
  parseCatalogResponse,
  resolveInstructionsForModel
} from "../lib/model-catalog"

function makeBaselineModel(id: string): Record<string, unknown> {
  return {
    id,
    slug: id,
    model: id,
    providerID: "openai",
    api: {
      id,
      url: "https://chatgpt.com/backend-api/codex",
      npm: "@ai-sdk/openai"
    },
    status: "active",
    headers: {},
    options: {},
    cost: {
      input: 1,
      output: 2,
      cache: { read: 3, write: 4 }
    },
    limit: {
      context: 111,
      input: 111,
      output: 222
    },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: false,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false
    },
    family: "legacy",
    release_date: "2026-01-01",
    variants: {
      none: { reasoningEffort: "none" }
    }
  }
}

describe("model catalog provider model mapping", () => {
  it("parses live catalog display metadata used by runtime shaping", () => {
    const parsed = parseCatalogResponse({
      models: [
        {
          slug: "gpt-5.4",
          display_name: "gpt-5.4",
          description: "A test model",
          priority: 0,
          context_window: 272000,
          input_modalities: ["text", "image"] as const,
          service_tiers: [{ id: "priority", name: "Fast" }, { id: " FLEX ", name: 42 }, { id: "" }, null],
          additional_speed_tiers: ["fast", " FAST ", "", null],
          supports_parallel_tool_calls: true,
          multi_agent_version: "v2",
          minimal_client_version: "0.144.0",
          visibility: "list",
          supported_in_api: true,
          supported_reasoning_levels: [{ effort: "ultra", description: "Maximum with delegation" }]
        }
      ]
    })

    expect(parsed).toEqual([
      {
        slug: "gpt-5.4",
        description: "A test model",
        display_name: "gpt-5.4",
        priority: 0,
        context_window: 272000,
        max_context_window: null,
        input_modalities: ["text", "image"] as const,
        service_tiers: [
          { id: "priority", name: "Fast" },
          { id: "flex", name: null }
        ],
        additional_speed_tiers: ["fast"],
        model_messages: null,
        base_instructions: null,
        apply_patch_tool_type: null,
        supported_reasoning_levels: [{ effort: "ultra", description: "Maximum with delegation" }],
        multi_agent_version: "v2",
        minimal_client_version: "0.144.0",
        visibility: "list",
        supported_in_api: true,
        default_reasoning_level: null,
        default_reasoning_summary: null,
        supports_reasoning_summaries: null,
        reasoning_summary_format: null,
        supports_parallel_tool_calls: true,
        support_verbosity: null,
        default_verbosity: null
      }
    ])
  })

  it("extracts runtime defaults and applies them to catalog-built provider models", () => {
    const providerModels: Record<string, Record<string, unknown>> = {
      "gpt-5.2-codex": makeBaselineModel("gpt-5.2-codex"),
      "o3-mini": { id: "o3-mini" }
    }

    const catalogModels = [
      {
        slug: "gpt-5.4-codex",
        display_name: "GPT-5.4 Frontier",
        context_window: 272000,
        input_modalities: ["text", "image"] as const,
        apply_patch_tool_type: "apply_patch",
        default_reasoning_level: "ultra",
        default_reasoning_summary: "auto",
        supported_reasoning_levels: [
          { effort: "low" },
          { effort: "medium" },
          { effort: "high" },
          { effort: "max" },
          { effort: "ultra" },
          { effort: "future-custom" }
        ],
        multi_agent_version: "v2",
        minimal_client_version: "0.144.0",
        visibility: "list",
        supported_in_api: true,
        supports_reasoning_summaries: true,
        reasoning_summary_format: "experimental",
        supports_parallel_tool_calls: false,
        support_verbosity: true,
        default_verbosity: "high",
        service_tiers: [{ id: "priority", name: "Fast" }],
        additional_speed_tiers: ["fast"],
        model_messages: {
          instructions_template: "Base {{ personality }}",
          instructions_variables: { personality_default: "Default" }
        }
      }
    ]

    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels,
      ultraEnabled: true
    })

    expect(providerModels["gpt-5.4-codex"]).toBeDefined()
    expect(providerModels["gpt-5.4-codex"].instructions).toBe("Base Default")
    expect(providerModels["gpt-5.4-codex"].name).toBe("GPT-5.4 Frontier")
    expect(providerModels["gpt-5.4-codex"].displayName).toBe("GPT-5.4 Frontier")
    expect(providerModels["o3-mini"]).toBeUndefined()
    expect(providerModels["gpt-5.4-codex"].codexRuntimeDefaults).toEqual({
      applyPatchToolType: "apply_patch",
      defaultReasoningEffort: "ultra",
      defaultReasoningSummary: "auto",
      supportedReasoningEfforts: ["low", "medium", "high", "max", "ultra", "future-custom"],
      supportsReasoningSummaries: true,
      reasoningSummaryFormat: "experimental",
      supportsParallelToolCalls: false,
      supportsVerbosity: true,
      defaultVerbosity: "high",
      supportedServiceTiers: ["priority"]
    })

    const defaults = getRuntimeDefaultsForSlug("gpt-5.4-codex-high", catalogModels)
    expect(defaults?.defaultReasoningEffort).toBe("ultra")
    expect(providerModels["gpt-5.4-codex"].variants).toEqual({
      low: { reasoningEffort: "low" },
      medium: { reasoningEffort: "medium" },
      high: { reasoningEffort: "high" },
      max: { reasoningEffort: "max" },
      ultra: { reasoningEffort: "ultra" },
      "future-custom": { reasoningEffort: "future-custom" }
    })
  })

  it("hides the Ultra WIP variant and maps an Ultra catalog default to Max unless enabled", () => {
    const model = {
      slug: "gpt-5.6-sol",
      context_window: 272000,
      default_reasoning_level: "ultra",
      supported_reasoning_levels: [{ effort: "max" }, { effort: "ultra" }],
      multi_agent_version: "v2",
      visibility: "list",
      supported_in_api: true
    }
    const disabledModels: Record<string, Record<string, unknown>> = {}
    applyCodexCatalogToProviderModels({ providerModels: disabledModels, catalogModels: [model] })
    expect(disabledModels[model.slug].variants).toEqual({ max: { reasoningEffort: "max" } })
    expect(disabledModels[model.slug].codexRuntimeDefaults).toMatchObject({
      defaultReasoningEffort: "max",
      supportedReasoningEfforts: ["max"]
    })

    const enabledModels: Record<string, Record<string, unknown>> = {}
    applyCodexCatalogToProviderModels({ providerModels: enabledModels, catalogModels: [model], ultraEnabled: true })
    expect(enabledModels[model.slug].variants).toMatchObject({ ultra: { reasoningEffort: "ultra" } })
  })

  it("creates new catalog-only provider entries without cross-slug inheritance", () => {
    const providerModels: Record<string, Record<string, unknown>> = {
      "gpt-5.3-codex": {
        ...makeBaselineModel("gpt-5.3-codex"),
        providerID: "custom-openai",
        api: {
          id: "gpt-5.3-codex",
          url: "https://example.invalid/custom",
          npm: "@custom/provider"
        },
        status: "deprecated",
        headers: {
          "x-test-header": "legacy"
        }
      }
    }

    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels: [
        {
          slug: "gpt-5.4",
          display_name: "gpt-5.4",
          context_window: 272000,
          input_modalities: ["text", "image"] as const,
          default_reasoning_level: "medium",
          supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "xhigh" }]
        }
      ]
    })

    expect(providerModels["gpt-5.4"].name).toBe("GPT-5.4")
    expect(providerModels["gpt-5.4"].displayName).toBe("GPT-5.4")
    expect(providerModels["gpt-5.4"].display_name).toBe("GPT-5.4")
    expect(providerModels["gpt-5.4"].providerID).toBe("openai")
    expect(providerModels["gpt-5.4"].api).toEqual({
      id: "gpt-5.4",
      url: "https://chatgpt.com/backend-api/codex",
      npm: "@ai-sdk/openai"
    })
    expect(providerModels["gpt-5.4"].status).toBe("active")
    expect(providerModels["gpt-5.4"].headers).toEqual({})
    expect(providerModels["gpt-5.4"].family).toBe("gpt-5")
    expect(providerModels["gpt-5.4"].release_date).toBe("")
    expect(providerModels["gpt-5.4"].limit).toEqual({
      context: 272000,
      input: 272000,
      output: 128000
    })
    expect(providerModels["gpt-5.4"].capabilities).toEqual({
      temperature: false,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false
    })
    expect(providerModels["gpt-5.4"].variants).toEqual({
      low: { reasoningEffort: "low" },
      medium: { reasoningEffort: "medium" },
      high: { reasoningEffort: "high" },
      xhigh: { reasoningEffort: "xhigh" }
    })
  })

  it("creates separate Fast, 1M, and Pro provider aliases without combinations", () => {
    const providerModels: Record<string, Record<string, unknown>> = {}
    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels: [
        {
          slug: "gpt-5.6-luna",
          display_name: "GPT-5.6 Luna",
          context_window: 372000,
          max_context_window: 1050000,
          service_tiers: [{ id: "priority", name: "Fast" }],
          additional_speed_tiers: ["fast"],
          supported_reasoning_levels: [{ effort: "high" }, { effort: "max" }]
        }
      ],
      aliasSettings: { fast: true, extendedContext: true, pro: true }
    })
    expect(Object.keys(providerModels).sort()).toEqual([
      "gpt-5.6-luna",
      "gpt-5.6-luna-1m",
      "gpt-5.6-luna-fast",
      "gpt-5.6-luna-pro"
    ])
    expect(providerModels["gpt-5.6-luna-fast"]).toMatchObject({
      name: "GPT-5.6 Luna Fast",
      api: { id: "gpt-5.6-luna" },
      variants: { high: { reasoningEffort: "high" }, max: { reasoningEffort: "max" } },
      options: { codexCustomModelConfig: { targetModel: "gpt-5.6-luna", serviceTier: "priority" } }
    })
    expect(providerModels["gpt-5.6-luna-1m"]).toMatchObject({
      name: "GPT-5.6 Luna 1M",
      api: { id: "gpt-5.6-luna" },
      limit: { context: 1050000, input: 922000, output: 128000 }
    })
    expect(providerModels["gpt-5.6-luna-pro"]).toMatchObject({
      name: "GPT-5.6 Luna Pro",
      api: { id: "gpt-5.6-luna" },
      options: { codexCustomModelConfig: { targetModel: "gpt-5.6-luna", reasoningMode: "pro" } }
    })
  })

  it("shapes API-key provider metadata without taking over authentication", () => {
    const providerModels = {
      "gpt-5.6-sol": {
        id: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        api: { id: "gpt-5.6-sol" },
        limit: { context: 1050000, input: 922000, output: 128000 },
        variants: { high: { reasoningEffort: "high" } },
        service_tiers: [{ id: "priority" }],
        additional_speed_tiers: ["fast"]
      }
    }
    applyGeneratedAliasesToProviderModels({
      providerModels,
      settings: { fast: true, extendedContext: true, pro: true }
    })
    expect(providerModels).toHaveProperty("gpt-5.6-sol-fast")
    expect(providerModels).toHaveProperty("gpt-5.6-sol-1m")
    expect(providerModels).toHaveProperty("gpt-5.6-sol-pro")
  })

  it("creates the documented 1M alias for the unsuffixed GPT-5.6 API alias", () => {
    const providerModels: Record<string, Record<string, unknown>> = {
      "gpt-5.6": {
        id: "gpt-5.6",
        name: "GPT-5.6",
        api: { id: "gpt-5.6" },
        limit: { context: 1050000, input: 922000, output: 128000 }
      }
    }
    applyGeneratedAliasesToProviderModels({
      providerModels,
      settings: { fast: false, extendedContext: true, pro: false }
    })
    expect(providerModels["gpt-5.6-1m"]).toMatchObject({
      name: "GPT-5.6 1M",
      api: { id: "gpt-5.6" },
      limit: { context: 1050000, input: 922000, output: 128000 }
    })
  })

  it("refreshes owned aliases and removes aliases disabled on a later refresh", () => {
    const providerModels: Record<string, Record<string, unknown>> = {}
    const catalog = (effort: string) => [
      {
        slug: "gpt-5.6-luna",
        display_name: "GPT-5.6 Luna",
        context_window: 372000,
        max_context_window: 1050000,
        service_tiers: [{ id: "priority", name: "Fast" }],
        additional_speed_tiers: ["fast"],
        supported_reasoning_levels: [{ effort }]
      }
    ]
    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels: catalog("high"),
      aliasSettings: { fast: true, extendedContext: true, pro: true }
    })
    expect(providerModels["gpt-5.6-luna-fast"]?.variants).toEqual({ high: { reasoningEffort: "high" } })

    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels: catalog("max"),
      aliasSettings: { fast: true, extendedContext: false, pro: false }
    })
    expect(providerModels["gpt-5.6-luna-fast"]?.variants).toEqual({ max: { reasoningEffort: "max" } })
    expect(providerModels).not.toHaveProperty("gpt-5.6-luna-1m")
    expect(providerModels).not.toHaveProperty("gpt-5.6-luna-pro")
  })

  it("does not overwrite an independently supplied suffix collision", () => {
    const providerModels: Record<string, Record<string, unknown>> = {
      "gpt-5.6-luna": { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
      "gpt-5.6-luna-pro": { id: "gpt-5.6-luna-pro", name: "Independent Pro Model" }
    }
    applyGeneratedAliasesToProviderModels({
      providerModels,
      settings: { fast: false, extendedContext: false, pro: true }
    })
    expect(providerModels["gpt-5.6-luna-pro"]?.name).toBe("Independent Pro Model")
  })

  it("preserves provider models when the catalog is temporarily unavailable", () => {
    const providerModels: Record<string, Record<string, unknown>> = {
      "gpt-5.3-codex": makeBaselineModel("gpt-5.3-codex")
    }

    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels: undefined
    })

    expect(providerModels["gpt-5.3-codex"]).toBeDefined()
  })

  it("replaces existing provider variants with the selected catalog source variants", () => {
    const providerModels: Record<string, Record<string, unknown>> = {
      "gpt-5.4": makeBaselineModel("gpt-5.4")
    }

    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels: [
        {
          slug: "gpt-5.4",
          context_window: 272000,
          input_modalities: ["text", "image"] as const,
          supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }]
        }
      ]
    })

    expect(providerModels["gpt-5.4"].variants).toEqual({
      low: { reasoningEffort: "low" },
      medium: { reasoningEffort: "medium" },
      high: { reasoningEffort: "high" }
    })
  })

  it("supports all variants from the current live catalog snapshot", async () => {
    const liveCatalogPayload = JSON.parse(
      await readFile(new URL("./fixtures/live-catalog-current.json", import.meta.url), "utf8")
    ) as unknown
    const catalogModels = parseCatalogResponse(liveCatalogPayload)
    const providerModels: Record<string, Record<string, unknown>> = {}

    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels
    })

    expect(Object.keys(providerModels).sort()).toEqual(catalogModels.map((model) => model.slug).sort())

    for (const model of catalogModels) {
      const supportedEfforts = (model.supported_reasoning_levels ?? []).flatMap((level) =>
        typeof level.effort === "string" ? [level.effort] : []
      )
      expect(providerModels[model.slug]?.variants).toEqual(
        Object.fromEntries(supportedEfforts.map((effort) => [effort, { reasoningEffort: effort }]))
      )
    }
  })

  it("synthesizes selectable custom models from active catalog targets", () => {
    const providerModels: Record<string, Record<string, unknown>> = {}

    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels: [
        {
          slug: "gpt-5.3-codex",
          display_name: "GPT-5.3 Codex",
          context_window: 272000,
          input_modalities: ["text", "image"] as const,
          model_messages: {
            instructions_template: "Base {{ personality }}",
            instructions_variables: { personality_default: "Default voice" }
          },
          default_reasoning_level: "medium",
          supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
          supports_reasoning_summaries: true,
          reasoning_summary_format: "auto",
          supports_parallel_tool_calls: false,
          support_verbosity: true,
          default_verbosity: "high"
        }
      ],
      customModels: {
        "openai/my-fast-codex": {
          targetModel: "gpt-5.3-codex",
          name: "My Fast Codex",
          reasoningSummary: "concise",
          variants: {
            high: {
              reasoningSummary: "detailed"
            }
          }
        }
      }
    })

    expect(providerModels["gpt-5.3-codex"]).toBeDefined()
    expect(providerModels["openai/my-fast-codex"]).toMatchObject({
      id: "openai/my-fast-codex",
      slug: "openai/my-fast-codex",
      model: "openai/my-fast-codex",
      name: "My Fast Codex",
      displayName: "My Fast Codex",
      display_name: "My Fast Codex",
      api: {
        id: "gpt-5.3-codex"
      }
    })
    expect(providerModels["openai/my-fast-codex"].options).toMatchObject({
      codexCatalogModel: {
        slug: "gpt-5.3-codex"
      },
      codexInstructions: "Base Default voice",
      codexRuntimeDefaults: {
        defaultReasoningEffort: "medium",
        supportedReasoningEfforts: ["low", "high"],
        supportsReasoningSummaries: true,
        reasoningSummaryFormat: "auto",
        supportsParallelToolCalls: false,
        supportsVerbosity: true,
        defaultVerbosity: "high"
      },
      codexCustomModelConfig: {
        slug: "openai/my-fast-codex",
        targetModel: "gpt-5.3-codex",
        reasoningSummary: "concise"
      }
    })
    expect(providerModels["openai/my-fast-codex"].instructions).toBe("Base Default voice")
    expect(providerModels["openai/my-fast-codex"].limit).toEqual(providerModels["gpt-5.3-codex"].limit)
    expect(providerModels["openai/my-fast-codex"].capabilities).toEqual(providerModels["gpt-5.3-codex"].capabilities)
    expect(providerModels["openai/my-fast-codex"].codexRuntimeDefaults).toEqual(
      providerModels["gpt-5.3-codex"].codexRuntimeDefaults
    )
    expect(providerModels["openai/my-fast-codex"].variants).toEqual({
      low: { reasoningEffort: "low" },
      high: { reasoningEffort: "high", reasoningSummary: "detailed" }
    })
  })

  it("warns and skips custom models whose target is missing from the active catalog", () => {
    const providerModels: Record<string, Record<string, unknown>> = {}
    const warn = vi.fn()

    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels: [
        {
          slug: "gpt-5.3-codex",
          context_window: 272000,
          input_modalities: ["text"]
        }
      ],
      customModels: {
        "openai/missing-target": {
          targetModel: "gpt-5.4"
        }
      },
      warn
    })

    expect(providerModels["openai/missing-target"]).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("customModels.openai/missing-target.targetModel"))
  })

  it("uses richer catalog display names when provided", () => {
    const providerModels: Record<string, Record<string, unknown>> = {
      "gpt-5.4": makeBaselineModel("gpt-5.4")
    }

    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels: [{ slug: "gpt-5.4", display_name: "GPT-5.4 Frontier", context_window: 272000 }]
    })

    expect(providerModels["gpt-5.4"].name).toBe("GPT-5.4 Frontier")
    expect(providerModels["gpt-5.4"].displayName).toBe("GPT-5.4 Frontier")
  })

  it("orders provider models by catalog priority before slug fallback", () => {
    const providerModels: Record<string, Record<string, unknown>> = {
      "gpt-5.2-codex": makeBaselineModel("gpt-5.2-codex"),
      "gpt-5.1-codex-mini": makeBaselineModel("gpt-5.1-codex-mini"),
      "gpt-5.3-codex": makeBaselineModel("gpt-5.3-codex")
    }

    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels: [
        { slug: "gpt-5.2-codex", priority: 3, context_window: 272000 },
        { slug: "gpt-5.1-codex-mini", priority: 12, context_window: 272000 },
        { slug: "gpt-5.3-codex", priority: 0, context_window: 272000 }
      ]
    })

    expect(Object.keys(providerModels)).toEqual(["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex-mini"])
  })

  it("falls back to newer-first slug ordering when catalog priorities are absent", () => {
    const providerModels: Record<string, Record<string, unknown>> = {
      "gpt-5.2-codex": makeBaselineModel("gpt-5.2-codex"),
      "gpt-5.1-codex-mini": makeBaselineModel("gpt-5.1-codex-mini"),
      "gpt-5.3-codex": makeBaselineModel("gpt-5.3-codex")
    }

    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels: [
        { slug: "gpt-5.2-codex", context_window: 272000 },
        { slug: "gpt-5.1-codex-mini", context_window: 272000 },
        { slug: "gpt-5.3-codex", context_window: 272000 }
      ]
    })

    expect(Object.keys(providerModels)).toEqual(["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex-mini"])
  })

  it("clears stale catalog-derived instructions when the catalog stops providing safe instructions", () => {
    const providerModels: Record<string, Record<string, unknown>> = {
      "gpt-5.4": makeBaselineModel("gpt-5.4")
    }

    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels: [
        {
          slug: "gpt-5.4",
          context_window: 272000,
          model_messages: {
            instructions_template: "Use {{ personality }}",
            instructions_variables: { personality_default: "Default tone" }
          }
        }
      ]
    })

    expect(providerModels["gpt-5.4"].instructions).toBe("Use Default tone")

    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels: [
        {
          slug: "gpt-5.4",
          context_window: 272000,
          model_messages: {
            instructions_template: "Use {{ personality }} and functions.exec_command"
          }
        }
      ]
    })

    expect(providerModels["gpt-5.4"].instructions).toBeUndefined()
    expect(providerModels["gpt-5.4"].options).toMatchObject({
      codexCatalogModel: {
        slug: "gpt-5.4"
      }
    })
    expect((providerModels["gpt-5.4"].options as Record<string, unknown>).codexInstructions).toBeUndefined()
  })

  it("falls back to safe base instructions when rendered templates contain stale bridge markers", () => {
    expect(
      resolveInstructionsForModel(
        {
          slug: "gpt-5.4",
          context_window: 272000,
          base_instructions: "Use the safe base",
          model_messages: {
            instructions_template: "Use {{ personality }} with multi_tool_use.parallel",
            instructions_variables: {
              personalities: {
                default: "Default tone"
              }
            }
          }
        },
        undefined
      )
    ).toBe("Use the safe base")
  })

  it("preserves provider models instead of clearing them when no catalog is available", () => {
    const providerModels: Record<string, Record<string, unknown>> = {
      "gpt-5.4": makeBaselineModel("gpt-5.4"),
      "gpt-5.3-codex": makeBaselineModel("gpt-5.3-codex")
    }

    applyCodexCatalogToProviderModels({
      providerModels,
      catalogModels: undefined
    })

    expect(Object.keys(providerModels).sort()).toEqual(["gpt-5.3-codex", "gpt-5.4"])
  })
})
