import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  CODEX_ORCHESTRATOR_PROMPT_URL,
  CODEX_PLAN_PROMPT_URL,
  CODEX_PROMPTS_CACHE_FILE,
  CODEX_PROMPTS_CACHE_META_FILE,
  readCachedCodexPrompts,
  refreshCachedCodexPrompts
} from "../lib/codex-prompts-cache"

async function makeCacheDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-prompts-cache-"))
}

describe("codex prompts cache", () => {
  it("refreshes and writes cache plus meta files", async () => {
    const cacheDir = await makeCacheDir()
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const endpoint = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url
      if (endpoint === CODEX_ORCHESTRATOR_PROMPT_URL) {
        return new Response("You are Codex, a coding agent based on GPT-5.", {
          status: 200,
          headers: { etag: 'W/"orch-etag"' }
        })
      }
      if (endpoint === CODEX_PLAN_PROMPT_URL) {
        return new Response("# Plan Mode (Conversational)", {
          status: 200,
          headers: { etag: 'W/"plan-etag"' }
        })
      }
      throw new Error(`unexpected URL: ${endpoint}`)
    })

    const prompts = await refreshCachedCodexPrompts({
      cacheDir,
      now: () => 1234,
      fetchImpl,
      forceRefresh: true
    })
    expect(prompts.orchestrator).toContain("You are Codex")
    expect(prompts.plan).toContain("# Plan Mode (Conversational)")

    const cacheRaw = await fs.readFile(path.join(cacheDir, CODEX_PROMPTS_CACHE_FILE), "utf8")
    const cache = JSON.parse(cacheRaw) as {
      fetchedAt?: number
      source?: string
      prompts?: { orchestrator?: string; plan?: string }
    }
    expect(cache.fetchedAt).toBe(1234)
    expect(cache.source).toBe("github")
    expect(cache.prompts?.orchestrator).toContain("You are Codex")
    expect(cache.prompts?.plan).toContain("# Plan Mode (Conversational)")

    const metaRaw = await fs.readFile(path.join(cacheDir, CODEX_PROMPTS_CACHE_META_FILE), "utf8")
    const meta = JSON.parse(metaRaw) as {
      lastChecked?: number
      urls?: { orchestrator?: string; plan?: string }
      etags?: { orchestrator?: string; plan?: string }
    }
    expect(meta.lastChecked).toBe(1234)
    expect(meta.urls?.orchestrator).toBe(CODEX_ORCHESTRATOR_PROMPT_URL)
    expect(meta.urls?.plan).toBe(CODEX_PLAN_PROMPT_URL)
    expect(meta.etags?.orchestrator).toBe('W/"orch-etag"')
    expect(meta.etags?.plan).toBe('W/"plan-etag"')
  })

  it("serves fresh cache without refetch", async () => {
    const cacheDir = await makeCacheDir()
    await fs.writeFile(
      path.join(cacheDir, CODEX_PROMPTS_CACHE_FILE),
      `${JSON.stringify(
        {
          fetchedAt: 500,
          source: "github",
          prompts: {
            orchestrator: "orch cached",
            plan: "plan cached"
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    )
    await fs.writeFile(
      path.join(cacheDir, CODEX_PROMPTS_CACHE_META_FILE),
      `${JSON.stringify(
        {
          lastChecked: 1_000,
          urls: {
            orchestrator: CODEX_ORCHESTRATOR_PROMPT_URL,
            plan: CODEX_PLAN_PROMPT_URL
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    )

    const fetchImpl = vi.fn(async () => {
      throw new Error("should not fetch")
    })
    const prompts = await refreshCachedCodexPrompts({
      cacheDir,
      now: () => 1_000 + 1000,
      fetchImpl
    })
    expect(prompts.orchestrator).toBe("orch cached")
    expect(prompts.plan).toBe("plan cached")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("returns cached prompts when refresh fails", async () => {
    const cacheDir = await makeCacheDir()
    await fs.writeFile(
      path.join(cacheDir, CODEX_PROMPTS_CACHE_FILE),
      `${JSON.stringify(
        {
          fetchedAt: 500,
          source: "github",
          prompts: {
            orchestrator: "orch cached",
            plan: "plan cached"
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    )
    await fs.writeFile(
      path.join(cacheDir, CODEX_PROMPTS_CACHE_META_FILE),
      `${JSON.stringify(
        {
          lastChecked: 1,
          urls: {
            orchestrator: CODEX_ORCHESTRATOR_PROMPT_URL,
            plan: CODEX_PLAN_PROMPT_URL
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    )

    const fetchImpl = vi.fn(async () => {
      throw new Error("network unavailable")
    })

    const prompts = await refreshCachedCodexPrompts({
      cacheDir,
      now: () => 1 + 48 * 60 * 60 * 1000,
      fetchImpl
    })
    expect(prompts.orchestrator).toBe("orch cached")
    expect(prompts.plan).toBe("plan cached")
  })

  it("reads cache with readCachedCodexPrompts", async () => {
    const cacheDir = await makeCacheDir()
    await fs.writeFile(
      path.join(cacheDir, CODEX_PROMPTS_CACHE_FILE),
      `${JSON.stringify(
        {
          fetchedAt: 500,
          source: "github",
          prompts: {
            orchestrator: "orch cached",
            plan: "plan cached"
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    )

    const prompts = await readCachedCodexPrompts({ cacheDir })
    expect(prompts.orchestrator).toBe("orch cached")
    expect(prompts.plan).toBe("plan cached")
  })

  it("updates lastChecked and keeps cached body on 304", async () => {
    const cacheDir = await makeCacheDir()
    await fs.writeFile(
      path.join(cacheDir, CODEX_PROMPTS_CACHE_FILE),
      `${JSON.stringify(
        {
          fetchedAt: 500,
          source: "github",
          prompts: {
            orchestrator: "orch cached",
            plan: "plan cached"
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    )
    await fs.writeFile(
      path.join(cacheDir, CODEX_PROMPTS_CACHE_META_FILE),
      `${JSON.stringify(
        {
          lastChecked: 1,
          urls: {
            orchestrator: CODEX_ORCHESTRATOR_PROMPT_URL,
            plan: CODEX_PLAN_PROMPT_URL
          },
          etags: {
            orchestrator: 'W/"orch-prev"',
            plan: 'W/"plan-prev"'
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    )

    const fetchImpl = vi.fn(async () => new Response(null, { status: 304 }))
    const prompts = await refreshCachedCodexPrompts({
      cacheDir,
      now: () => 2,
      fetchImpl,
      forceRefresh: true
    })

    expect(prompts.orchestrator).toBe("orch cached")
    expect(prompts.plan).toBe("plan cached")
    const cacheRaw = await fs.readFile(path.join(cacheDir, CODEX_PROMPTS_CACHE_FILE), "utf8")
    const cache = JSON.parse(cacheRaw) as { fetchedAt?: number; prompts?: { orchestrator?: string; plan?: string } }
    expect(cache.fetchedAt).toBe(2)
    expect(cache.prompts?.orchestrator).toBe("orch cached")
    expect(cache.prompts?.plan).toBe("plan cached")

    const metaRaw = await fs.readFile(path.join(cacheDir, CODEX_PROMPTS_CACHE_META_FILE), "utf8")
    const meta = JSON.parse(metaRaw) as {
      lastChecked?: number
      etags?: { orchestrator?: string; plan?: string }
      urls?: { orchestrator?: string; plan?: string }
    }
    expect(meta.lastChecked).toBe(2)
    expect(meta.urls?.orchestrator).toBe(CODEX_ORCHESTRATOR_PROMPT_URL)
    expect(meta.urls?.plan).toBe(CODEX_PLAN_PROMPT_URL)
    expect(meta.etags?.orchestrator).toBe('W/"orch-prev"')
    expect(meta.etags?.plan).toBe('W/"plan-prev"')
  })

  it("deduplicates concurrent refresh calls for same cache dir", async () => {
    const cacheDir = await makeCacheDir()
    const resolvers = new Map<string, (value: Response) => void>()
    let resolveStart: (() => void) | undefined
    const orchestratorFetchStarted = new Promise<void>((resolve) => {
      resolveStart = resolve
    })
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const endpoint = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url
      if (endpoint === CODEX_ORCHESTRATOR_PROMPT_URL) {
        resolveStart?.()
      }
      return await new Promise<Response>((resolve) => {
        resolvers.set(endpoint, resolve)
      })
    })

    const first = refreshCachedCodexPrompts({ cacheDir, now: () => 9, fetchImpl, forceRefresh: false })
    await orchestratorFetchStarted
    const second = refreshCachedCodexPrompts({ cacheDir, now: () => 9, fetchImpl, forceRefresh: false })

    await vi.waitFor(() => {
      expect(resolvers.size).toBe(2)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    resolvers.get(CODEX_ORCHESTRATOR_PROMPT_URL)?.(new Response("orch net", { status: 200 }))
    resolvers.get(CODEX_PLAN_PROMPT_URL)?.(new Response("plan net", { status: 200 }))

    const [a, b] = await Promise.all([first, second])
    expect(a.orchestrator).toBe("orch net")
    expect(b.orchestrator).toBe("orch net")
    expect(a.plan).toBe("plan net")
    expect(b.plan).toBe("plan net")
  })
})
