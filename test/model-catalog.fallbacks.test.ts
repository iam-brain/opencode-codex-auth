import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import { getCodexModelCatalog, type CodexModelCatalogEvent } from "../lib/model-catalog"

async function makeCacheDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-model-catalog-"))
}

describe("model catalog fallback behavior", () => {
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

  it("treats whitespace access token as unavailable and uses stale fallback", async () => {
    const cacheDir = await makeCacheDir()
    const fallbackFile = path.join(cacheDir, "codex-models-cache-test.json")
    await fs.writeFile(
      fallbackFile,
      JSON.stringify(
        {
          fetchedAt: 1234,
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
    expect(
      events.some((event) => event.type === "stale_cache_used" && event.reason === "opencode_cache_fallback")
    ).toBe(true)
  })

  it("refreshes from network after no-token fallback once access token becomes available", async () => {
    const cacheDir = await makeCacheDir()
    const fallbackFile = path.join(cacheDir, "codex-models-cache-test.json")
    await fs.writeFile(
      fallbackFile,
      JSON.stringify(
        {
          fetchedAt: 100,
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
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(tokenEvents.some((event) => event.type === "network_fetch_success")).toBe(true)
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
})
