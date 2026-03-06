import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"
import type { CodexModelCatalogEvent } from "../lib/model-catalog"

async function makeCacheDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-model-catalog-"))
}

describe("model catalog fallback behavior", () => {
  afterEach(() => {
    vi.resetModules()
  })

  it("uses stale disk cache when token is unavailable and emits telemetry", async () => {
    const { getCodexModelCatalog } = await import("../lib/model-catalog")
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

  it("treats whitespace access token as unavailable and uses the upstream github cache", async () => {
    const { getCodexModelCatalog } = await import("../lib/model-catalog")
    const cacheDir = await makeCacheDir()
    await fs.writeFile(
      path.join(cacheDir, "codex-models-cache.json"),
      JSON.stringify(
        {
          fetchedAt: 1234,
          source: "github",
          models: [{ slug: "gpt-5.2-codex" }]
        },
        null,
        2
      ),
      "utf8"
    )

    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ models: [{ slug: "gpt-5.4-codex" }] }), { status: 200 })
    })
    const events: CodexModelCatalogEvent[] = []

    const models = await getCodexModelCatalog({
      accessToken: "   ",
      cacheDir,
      fetchImpl,
      onEvent: (event) => events.push(event)
    })

    expect(models?.map((model) => model.slug)).toEqual(["gpt-5.2-codex"])
    expect(fetchImpl).toHaveBeenCalledTimes(0)
    expect(events.some((event) => event.type === "stale_cache_used" && event.reason === "github_cache_fallback")).toBe(
      true
    )
  })

  it("refreshes from network after github-cache fallback once access token becomes available", async () => {
    const { getCodexModelCatalog } = await import("../lib/model-catalog")
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

    const noTokenEvents: CodexModelCatalogEvent[] = []
    const fromFallback = await getCodexModelCatalog({
      cacheDir,
      accountId: "acc_123",
      now: () => 1_000,
      onEvent: (event) => noTokenEvents.push(event)
    })
    expect(fromFallback?.map((model) => model.slug)).toEqual(["gpt-5.2-codex"])
    expect(noTokenEvents.some((event) => event.type === "stale_cache_used")).toBe(true)

    const tokenEvents: CodexModelCatalogEvent[] = []
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          models: [{ slug: "gpt-5.4-codex" }]
        }),
        { status: 200 }
      )
    })

    const refreshed = await getCodexModelCatalog({
      cacheDir,
      accountId: "acc_123",
      accessToken: "at",
      fetchImpl,
      now: () => 1_001,
      onEvent: (event) => tokenEvents.push(event)
    })

    expect(refreshed?.map((model) => model.slug)).toEqual(["gpt-5.4-codex"])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(tokenEvents.some((event) => event.type === "network_fetch_success")).toBe(true)
  })

  it("falls back to the upstream github cache when the network fetch fails", async () => {
    const { getCodexModelCatalog } = await import("../lib/model-catalog")
    const cacheDir = await makeCacheDir()
    await fs.writeFile(
      path.join(cacheDir, "codex-models-cache.json"),
      JSON.stringify(
        {
          fetchedAt: 1234,
          source: "github",
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
    expect(events.some((event) => event.type === "stale_cache_used" && event.reason === "github_cache_fallback")).toBe(
      true
    )
  })

  it("returns undefined when neither the endpoint nor github fallback is available", async () => {
    const { getCodexModelCatalog } = await import("../lib/model-catalog")
    const cacheDir = await makeCacheDir()
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

    expect(models).toBeUndefined()
    expect(events.some((event) => event.type === "catalog_unavailable")).toBe(true)
    expect(events.some((event) => event.reason === "github_cache_fallback")).toBe(false)
  })
})
