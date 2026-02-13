import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  applyCodexCatalogToProviderModels,
  getCodexModelCatalog,
  getRuntimeDefaultsForSlug,
  resolveInstructionsForModel,
  type CodexModelCatalogEvent
} from "../lib/model-catalog"

async function makeCacheDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-model-catalog-"))
}

describe("model catalog", () => {
  it("fetches /codex/models with auth headers", async () => {
    const cacheDir = await makeCacheDir()
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const endpoint = typeof url === "string" ? url : url instanceof URL ? url.toString() : new URL(url.url).toString()
      expect(endpoint).toContain("/backend-api/codex/models")
      expect(endpoint).toContain("client_version=0.97.0")
      const headers = init?.headers as Record<string, string>
      expect(headers.authorization).toBe("Bearer at")
      expect(headers["chatgpt-account-id"]).toBe("acc_123")
      expect(headers.version).toBe("0.97.0")

      return new Response(
        JSON.stringify({
          models: [{ slug: "gpt-5.4-codex" }, { slug: "gpt-5.1-codex-mini" }, { slug: "gpt-5.2-codex" }]
        }),
        { status: 200 }
      )
    })

    const result = await getCodexModelCatalog({
      accessToken: "at",
      accountId: "acc_123",
      fetchImpl,
      forceRefresh: true,
      cacheDir,
      now: () => 1000
    })

    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })
    expect(result?.map((m) => m.slug)).toEqual(["gpt-5.1-codex-mini", "gpt-5.2-codex", "gpt-5.4-codex"])
  })

  it("writes plugin cache into codex-auth and codex-models-cache shard files", async () => {
    const cacheDir = await makeCacheDir()
    const result = await getCodexModelCatalog({
      accessToken: "at",
      accountId: "acc_123",
      forceRefresh: true,
      cacheDir,
      now: () => 4242,
      fetchImpl: async () => {
        return new Response(
          JSON.stringify({
            models: [{ slug: "gpt-5.3-codex" }]
          }),
          { status: 200 }
        )
      }
    })

    expect(result?.map((model) => model.slug)).toEqual(["gpt-5.3-codex"])

    const cacheEntries = await fs.readdir(cacheDir)
    const authShards = cacheEntries.filter((name) => /^codex-auth-models-[a-f0-9]{16}\.json$/.test(name))
    const opencodeShards = cacheEntries.filter((name) => /^codex-models-cache-[a-f0-9]{16}\.json$/.test(name))

    expect(authShards.length).toBe(1)
    expect(opencodeShards.length).toBe(1)
    expect(cacheEntries).not.toContain("codex-models-cache.json")
  })

  it("refreshes shared github models cache when client version bumps", async () => {
    const cacheDir = await makeCacheDir()
    await fs.writeFile(
      path.join(cacheDir, "codex-models-cache.json"),
      JSON.stringify(
        {
          fetchedAt: 100,
          source: "github",
          models: [{ slug: "gpt-5.2-codex" }]
        },
        null,
        2
      ),
      "utf8"
    )
    await fs.writeFile(
      path.join(cacheDir, "codex-models-cache-meta.json"),
      JSON.stringify(
        {
          version: "0.98.0",
          tag: "rust-v0.98.0",
          lastChecked: 100,
          url: "https://raw.githubusercontent.com/openai/codex/rust-v0.98.0/codex-rs/core/models.json"
        },
        null,
        2
      ),
      "utf8"
    )

    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const endpoint = typeof url === "string" ? url : url instanceof URL ? url.toString() : new URL(url.url).toString()
      expect(endpoint).toBe("https://raw.githubusercontent.com/openai/codex/rust-v0.99.0/codex-rs/core/models.json")
      return new Response(
        JSON.stringify({
          models: [{ slug: "gpt-5.3-codex" }]
        }),
        {
          status: 200,
          headers: {
            etag: 'W/"models-099"'
          }
        }
      )
    })

    const models = await getCodexModelCatalog({
      cacheDir,
      clientVersion: "0.99.0",
      refreshGithubModelsCache: true,
      now: () => 200,
      fetchImpl
    })

    expect(models?.map((model) => model.slug)).toContain("gpt-5.3-codex")
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const sharedRaw = await fs.readFile(path.join(cacheDir, "codex-models-cache.json"), "utf8")
    const shared = JSON.parse(sharedRaw) as { fetchedAt?: number; source?: string; models?: Array<{ slug?: string }> }
    expect(shared.fetchedAt).toBe(200)
    expect(shared.source).toBe("github")
    expect(shared.models?.map((model) => model.slug)).toContain("gpt-5.3-codex")

    const metaRaw = await fs.readFile(path.join(cacheDir, "codex-models-cache-meta.json"), "utf8")
    const meta = JSON.parse(metaRaw) as {
      etag?: string
      tag?: string
      lastChecked?: number
      url?: string
      version?: string
    }
    expect(meta.etag).toBe('W/"models-099"')
    expect(meta.tag).toBe("rust-v0.99.0")
    expect(meta.lastChecked).toBe(200)
    expect(meta.url).toBe("https://raw.githubusercontent.com/openai/codex/rust-v0.99.0/codex-rs/core/models.json")
    expect(meta.version).toBeUndefined()
  })

  it("deduplicates concurrent network catalog fetches for the same cache key", async () => {
    const cacheDir = await makeCacheDir()
    let resolveFetch: ((value: Response) => void) | undefined
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    const fetchImpl = vi.fn(async () => pendingFetch)

    const first = getCodexModelCatalog({
      accessToken: "at",
      accountId: "acc_123",
      fetchImpl,
      forceRefresh: true,
      cacheDir,
      now: () => 1000
    })
    const second = getCodexModelCatalog({
      accessToken: "at",
      accountId: "acc_123",
      fetchImpl,
      forceRefresh: true,
      cacheDir,
      now: () => 1000
    })

    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })
    resolveFetch?.(
      new Response(
        JSON.stringify({
          models: [{ slug: "gpt-5.4-codex" }, { slug: "gpt-5.2-codex" }]
        }),
        { status: 200 }
      )
    )

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult?.map((m) => m.slug)).toEqual(["gpt-5.2-codex", "gpt-5.4-codex"])
    expect(secondResult?.map((m) => m.slug)).toEqual(["gpt-5.2-codex", "gpt-5.4-codex"])
  })

  it("honors caller-provided originator/user-agent/beta headers", async () => {
    const cacheDir = await makeCacheDir()
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const endpoint = typeof url === "string" ? url : url instanceof URL ? url.toString() : new URL(url.url).toString()
      expect(endpoint).toContain("client_version=9.9.9")
      const headers = init?.headers as Record<string, string>
      expect(headers.originator).toBe("codex_exec")
      expect(headers["user-agent"]).toBe("codex_exec/0.1.0 (Mac OS 26.3; arm64) ghostty/1.2.3")
      expect(headers["openai-beta"]).toBeUndefined()
      expect(headers.authorization).toBe("Bearer at")
      expect(headers.version).toBe("9.9.8")
      return new Response(JSON.stringify({ models: [{ slug: "gpt-5.4-codex" }] }), {
        status: 200
      })
    })

    await getCodexModelCatalog({
      accessToken: "at",
      accountId: "acc_123",
      originator: "codex_exec",
      userAgent: "codex_exec/0.1.0 (Mac OS 26.3; arm64) ghostty/1.2.3",
      clientVersion: "9.9.9",
      versionHeader: "9.9.8",
      fetchImpl,
      forceRefresh: true,
      cacheDir,
      now: () => 1000
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("uses stale disk cache when token is unavailable and emits telemetry", async () => {
    const cacheDir = await makeCacheDir()

    const events: CodexModelCatalogEvent[] = []
    await getCodexModelCatalog({
      accessToken: "at",
      accountId: "acc_123",
      cacheDir,
      forceRefresh: true,
      now: () => 1000,
      fetchImpl: async () => {
        return new Response(
          JSON.stringify({
            models: [{ slug: "gpt-5.4-codex" }]
          }),
          { status: 200 }
        )
      },
      onEvent: (event) => events.push(event)
    })

    const staleEvents: CodexModelCatalogEvent[] = []
    const stale = await getCodexModelCatalog({
      accountId: "acc_123",
      cacheDir,
      now: () => 1000 + 16 * 60 * 1000,
      onEvent: (event) => staleEvents.push(event)
    })

    expect(stale?.map((model) => model.slug)).toEqual(["gpt-5.4-codex"])
    expect(staleEvents.some((event) => event.type === "stale_cache_used")).toBe(true)
  })

  it("falls back to OpenCode codex-models cache when network fetch fails", async () => {
    const cacheDir = await makeCacheDir()
    const fallbackFile = path.join(cacheDir, "codex-models-cache-test.json")
    await fs.writeFile(
      fallbackFile,
      JSON.stringify(
        {
          fetchedAt: 1234,
          models: [
            {
              slug: "gpt-5.3-codex",
              model_messages: {
                instructions_template: "Base {{ personality }}",
                instructions_variables: {
                  personality_default: "Default voice"
                }
              }
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    )

    const events: CodexModelCatalogEvent[] = []
    const models = await getCodexModelCatalog({
      accessToken: "at",
      accountId: "acc_123",
      cacheDir,
      forceRefresh: true,
      fetchImpl: async () => {
        throw new Error("network down")
      },
      onEvent: (event) => events.push(event)
    })

    expect(models?.map((model) => model.slug)).toEqual(["gpt-5.3-codex"])
    expect(events.some((event) => event.type === "network_fetch_failed")).toBe(true)
    expect(
      events.some((event) => event.type === "stale_cache_used" && event.reason === "opencode_cache_fallback")
    ).toBe(true)
  })

  it("falls back to codex-auth shard cache files when shared cache is unavailable", async () => {
    const cacheDir = await makeCacheDir()
    const shardFile = path.join(cacheDir, "codex-auth-models-deadbeefcafebabe.json")
    await fs.writeFile(
      shardFile,
      JSON.stringify(
        {
          fetchedAt: 2345,
          models: [
            {
              slug: "gpt-5.2-codex",
              base_instructions: "Shard fallback instructions"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    )

    const events: CodexModelCatalogEvent[] = []
    const models = await getCodexModelCatalog({
      cacheDir,
      now: () => 3000,
      onEvent: (event) => events.push(event)
    })

    expect(models?.map((model) => model.slug)).toEqual(["gpt-5.2-codex"])
    expect(
      events.some((event) => event.type === "stale_cache_used" && event.reason === "opencode_cache_fallback")
    ).toBe(true)
  })

  it("falls back to Codex CLI models_cache when OpenCode cache files are unavailable", async () => {
    const cacheDir = await makeCacheDir()
    const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-home-"))
    const codexDir = path.join(fakeHome, ".codex")
    await fs.mkdir(codexDir, { recursive: true })
    await fs.writeFile(
      path.join(codexDir, "models_cache.json"),
      JSON.stringify(
        {
          fetched_at: "2026-02-12T17:36:20.966526Z",
          models: [
            {
              slug: "gpt-5.2-codex",
              base_instructions: "CLI fallback instructions"
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    )

    const homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(fakeHome)
    const events: CodexModelCatalogEvent[] = []
    try {
      const models = await getCodexModelCatalog({
        cacheDir,
        now: () => 4000,
        onEvent: (event) => events.push(event)
      })

      expect(models?.map((model) => model.slug)).toEqual(["gpt-5.2-codex"])
      expect(
        events.some((event) => event.type === "stale_cache_used" && event.reason === "codex_cli_cache_fallback")
      ).toBe(true)
    } finally {
      homedirSpy.mockRestore()
    }
  })

  it("renders personality in model instructions template", async () => {
    const root = await makeCacheDir()
    const prevCwd = process.cwd()
    const prevXdg = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = path.join(root, "xdg-empty")
    process.chdir(root)
    try {
      const instructions = resolveInstructionsForModel(
        {
          slug: "gpt-5.4-codex",
          model_messages: {
            instructions_template: "Base {{ personality }}",
            instructions_variables: {
              personality_friendly: "Friendly"
            }
          }
        },
        "friendly"
      )

      expect(instructions).toBe("Base Friendly")
    } finally {
      process.chdir(prevCwd)
      if (prevXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME
      } else {
        process.env.XDG_CONFIG_HOME = prevXdg
      }
    }
  })

  it("prefers model template over base instructions when both exist", () => {
    const instructions = resolveInstructionsForModel({
      slug: "gpt-5.4-codex",
      base_instructions: "Use base instructions first",
      model_messages: {
        instructions_template: "Template {{ personality }}",
        instructions_variables: {
          personality_default: "Default"
        }
      }
    })

    expect(instructions).toBe("Template Default")
  })

  it("does not use local personality text when base and template are missing", async () => {
    const root = await makeCacheDir()
    const personalityDir = path.join(root, ".opencode", "personalities")
    await fs.mkdir(personalityDir, { recursive: true })
    await fs.writeFile(path.join(personalityDir, "Operator.md"), "Local cached instruction body", "utf8")

    const prev = process.cwd()
    process.chdir(root)
    try {
      const instructions = resolveInstructionsForModel({ slug: "gpt-5.4-codex" }, "operator")
      expect(instructions).toBeUndefined()
    } finally {
      process.chdir(prev)
    }
  })

  it("falls back to base instructions when template leaves unresolved markers", () => {
    const instructions = resolveInstructionsForModel({
      slug: "gpt-5.4-codex",
      base_instructions: "Safe base instructions",
      model_messages: {
        instructions_template: "Base {{ personality }} {{ unsupported_marker }}"
      }
    })

    expect(instructions).toBe("Safe base instructions")
  })

  it("falls back to base instructions when template includes stale bridge tool markers", () => {
    const instructions = resolveInstructionsForModel({
      slug: "gpt-5.4-codex",
      base_instructions: "Safe base instructions",
      model_messages: {
        instructions_template: "Use multi_tool_use.parallel with recipient_name=functions.read and function calls"
      }
    })

    expect(instructions).toBe("Safe base instructions")
  })

  it("renders custom personality content from local file", async () => {
    const root = await makeCacheDir()
    const personalityDir = path.join(root, ".opencode", "personalities")
    await fs.mkdir(personalityDir, { recursive: true })
    await fs.writeFile(path.join(personalityDir, "Pirate.md"), "Talk like a pirate", "utf8")

    const prev = process.cwd()
    process.chdir(root)
    try {
      const instructions = resolveInstructionsForModel(
        {
          slug: "gpt-5.4-codex",
          model_messages: {
            instructions_template: "Base {{ personality }}"
          }
        },
        "pirate"
      )

      expect(instructions).toBe("Base Talk like a pirate")
    } finally {
      process.chdir(prev)
    }
  })

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
