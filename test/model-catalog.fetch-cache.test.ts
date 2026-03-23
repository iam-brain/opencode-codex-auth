import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import { getCodexModelCatalog, type CodexModelCatalogEvent } from "../lib/model-catalog"

async function makeCacheDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-model-catalog-"))
}

describe("model catalog fetch and primary cache", () => {
  it("fetches /codex/models with auth headers", async () => {
    const cacheDir = await makeCacheDir()
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const endpoint = typeof url === "string" ? url : url instanceof URL ? url.toString() : new URL(url.url).toString()
      if (endpoint.includes("/backend-api/codex/models")) {
        expect(endpoint).toContain("client_version=0.116.0")
        const headers = init?.headers as Record<string, string>
        expect(headers.authorization).toBe("Bearer at")
        expect(headers["chatgpt-account-id"]).toBe("acc_123")
        expect(headers.version).toBe("0.116.0")

        return new Response(
          JSON.stringify({
            models: [{ slug: "gpt-5.4-codex" }, { slug: "gpt-5.1-codex-mini" }, { slug: "gpt-5.2-codex" }]
          }),
          { status: 200 }
        )
      }

      expect(endpoint).toBe("https://raw.githubusercontent.com/openai/codex/rust-v0.116.0/codex-rs/core/models.json")
      return new Response(
        JSON.stringify({
          models: [
            { slug: "gpt-5.4-codex", context_window: 272000, input_modalities: ["text", "image"] },
            { slug: "gpt-5.1-codex-mini", context_window: 272000, input_modalities: ["text"] },
            { slug: "gpt-5.2-codex", context_window: 272000, input_modalities: ["text", "image"] }
          ]
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
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })
    expect(result?.map((m) => m.slug)).toEqual(["gpt-5.1-codex-mini", "gpt-5.2-codex", "gpt-5.4-codex"])
    expect(result?.find((model) => model.slug === "gpt-5.4-codex")?.context_window).toBeNull()
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
    expect(cacheEntries).toContain("codex-models-cache.json")
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

  it("rebuilds the shared github cache when metadata is current but the cache file is missing", async () => {
    const cacheDir = await makeCacheDir()
    await fs.writeFile(
      path.join(cacheDir, "codex-models-cache-meta.json"),
      JSON.stringify(
        {
          tag: "rust-v0.99.0",
          lastChecked: 100,
          url: "https://raw.githubusercontent.com/openai/codex/rust-v0.99.0/codex-rs/core/models.json"
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
          models: [{ slug: "gpt-5.4-codex", context_window: 272000 }]
        }),
        { status: 200 }
      )
    })

    const models = await getCodexModelCatalog({
      cacheDir,
      clientVersion: "0.99.0",
      refreshGithubModelsCache: true,
      now: () => 200,
      fetchImpl
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(models?.map((model) => model.slug)).toEqual(["gpt-5.4-codex"])

    const sharedRaw = await fs.readFile(path.join(cacheDir, "codex-models-cache.json"), "utf8")
    const shared = JSON.parse(sharedRaw) as { source?: string; models?: Array<{ slug?: string }> }
    expect(shared.source).toBe("github")
    expect(shared.models?.map((model) => model.slug)).toEqual(["gpt-5.4-codex"])
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

  it("returns fresh primary disk cache without scanning fallback caches", async () => {
    const cacheDir = await makeCacheDir()

    await getCodexModelCatalog({
      accessToken: "at",
      accountId: "acc_123",
      forceRefresh: true,
      cacheDir,
      now: () => 1000,
      fetchImpl: async () => {
        return new Response(
          JSON.stringify({
            models: [{ slug: "gpt-5.3-codex" }]
          }),
          { status: 200 }
        )
      }
    })

    const readdirSpy = vi.spyOn(fs, "readdir")

    const events: CodexModelCatalogEvent[] = []
    const models = await getCodexModelCatalog({
      accessToken: "at",
      accountId: "acc_123",
      cacheDir,
      now: () => 1001,
      fetchImpl: async () => {
        throw new Error("should not refetch network")
      },
      onEvent: (event) => events.push(event)
    })

    expect(models?.map((model) => model.slug)).toEqual(["gpt-5.3-codex"])
    expect(readdirSpy).not.toHaveBeenCalledWith(cacheDir)
    expect(events.some((event) => event.type === "memory_cache_hit" || event.type === "disk_cache_hit")).toBe(true)
    expect(events.some((event) => event.type === "network_fetch_failed")).toBe(false)
    readdirSpy.mockRestore()
  })

  it("honors caller-provided originator/user-agent/beta headers", async () => {
    const cacheDir = await makeCacheDir()
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const endpoint = typeof url === "string" ? url : url instanceof URL ? url.toString() : new URL(url.url).toString()
      if (endpoint.includes("/backend-api/codex/models")) {
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
      }

      expect(endpoint).toBe("https://raw.githubusercontent.com/openai/codex/rust-v9.9.9/codex-rs/core/models.json")
      return new Response(JSON.stringify({ models: [{ slug: "gpt-5.4-codex", context_window: 272000 }] }), {
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

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
