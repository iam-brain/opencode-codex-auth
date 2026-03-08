import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { resetStubbedGlobals, stubGlobalForTest } from "./helpers/mock-policy"

type VariantConfigMap = Record<string, Record<string, unknown>>

type PluginConfigLike = {
  provider: {
    openai: {
      models: Record<
        string,
        {
          variants: VariantConfigMap
        }
      >
    }
  }
}

function makeConfig(): PluginConfigLike {
  return {
    provider: {
      openai: {
        models: {
          "gpt-5.4": {
            variants: {
              low: { reasoningEffort: "low" },
              medium: { reasoningEffort: "medium" },
              high: { reasoningEffort: "high" }
            }
          },
          "gpt-5-codex-mini": {
            variants: {
              low: { reasoningEffort: "low" },
              medium: { reasoningEffort: "medium" },
              high: { reasoningEffort: "high" }
            }
          }
        }
      }
    }
  }
}

async function withIsolatedHome<T>(fn: () => Promise<T>): Promise<T> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-config-variants-home-"))
  const xdgConfig = path.join(home, ".config")
  const xdgCache = path.join(home, ".cache")
  await fs.mkdir(xdgConfig, { recursive: true })
  await fs.mkdir(xdgCache, { recursive: true })

  const prevHome = process.env.HOME
  const prevXdg = process.env.XDG_CONFIG_HOME
  const prevXdgCache = process.env.XDG_CACHE_HOME
  process.env.HOME = home
  process.env.XDG_CONFIG_HOME = xdgConfig
  process.env.XDG_CACHE_HOME = xdgCache

  try {
    return await fn()
  } finally {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = prevXdg
    if (prevXdgCache === undefined) delete process.env.XDG_CACHE_HOME
    else process.env.XDG_CACHE_HOME = prevXdgCache
  }
}

async function seedAuthFixture(expires: number): Promise<void> {
  const fixturePath = path.join(process.cwd(), "test", "fixtures", "auth-multi.json")
  const raw = await fs.readFile(fixturePath, "utf8")
  const parsed = JSON.parse(raw) as {
    openai?: { accounts?: Array<{ expires?: number }> }
  }
  const account = parsed.openai?.accounts?.[0]
  if (account) {
    account.expires = expires
  }
  const authPath = path.join(process.env.XDG_CONFIG_HOME ?? "", "opencode", "codex-accounts.json")
  await fs.mkdir(path.dirname(authPath), { recursive: true })
  await fs.writeFile(authPath, JSON.stringify(parsed, null, 2), "utf8")
}

describe("codex-native config variants", () => {
  afterEach(() => {
    resetStubbedGlobals()
    vi.resetModules()
  })

  it("adds missing supported variants and disables unsupported built-in variants from the selected catalog", async () => {
    await withIsolatedHome(async () => {
      await seedAuthFixture(Date.now() + 60_000)
      stubGlobalForTest(
        "fetch",
        vi.fn(async (url: string | URL | Request) => {
          const endpoint =
            typeof url === "string" ? url : url instanceof URL ? url.toString() : new URL(url.url).toString()
          if (endpoint.includes("/backend-api/codex/models")) {
            return new Response(
              JSON.stringify({
                models: [
                  {
                    slug: "gpt-5.4",
                    context_window: 272000,
                    input_modalities: ["text", "image"],
                    supported_reasoning_levels: [
                      { effort: "low" },
                      { effort: "medium" },
                      { effort: "high" },
                      { effort: "xhigh" }
                    ]
                  },
                  {
                    slug: "gpt-5-codex-mini",
                    context_window: 272000,
                    input_modalities: ["text", "image"],
                    supported_reasoning_levels: [{ effort: "medium" }, { effort: "high" }]
                  }
                ]
              }),
              { status: 200 }
            )
          }
          if (endpoint.includes("raw.githubusercontent.com/openai/codex/")) {
            return new Response(JSON.stringify({ models: [] }), { status: 200 })
          }
          return new Response("ok", { status: 200 })
        })
      )

      const { CodexAuthPlugin } = await import("../lib/codex-native")
      const hooks = await CodexAuthPlugin({} as never)
      const config = makeConfig()

      await hooks.config?.(config as never)

      expect(config.provider.openai.models["gpt-5.4"].variants.xhigh).toEqual({
        reasoningEffort: "xhigh",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"]
      })
      expect(config.provider.openai.models["gpt-5-codex-mini"].variants.low).toEqual({ disabled: true })
      expect(config.provider.openai.models["gpt-5-codex-mini"].variants.medium).toEqual({
        reasoningEffort: "medium",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"]
      })
      expect(config.provider.openai.models["gpt-5-codex-mini"].variants.high).toEqual({
        reasoningEffort: "high",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"]
      })
    })
  })

  it("leaves existing variants untouched when a catalog model has no supported reasoning levels", async () => {
    await withIsolatedHome(async () => {
      await seedAuthFixture(Date.now() + 60_000)
      stubGlobalForTest(
        "fetch",
        vi.fn(async (url: string | URL | Request) => {
          const endpoint =
            typeof url === "string" ? url : url instanceof URL ? url.toString() : new URL(url.url).toString()
          if (endpoint.includes("/backend-api/codex/models")) {
            return new Response(
              JSON.stringify({
                models: [
                  {
                    slug: "gpt-5.4",
                    context_window: 272000,
                    input_modalities: ["text", "image"]
                  }
                ]
              }),
              { status: 200 }
            )
          }
          if (endpoint.includes("raw.githubusercontent.com/openai/codex/")) {
            return new Response(JSON.stringify({ models: [] }), { status: 200 })
          }
          return new Response("ok", { status: 200 })
        })
      )

      const { CodexAuthPlugin } = await import("../lib/codex-native")
      const hooks = await CodexAuthPlugin({} as never)
      const config = makeConfig()
      const baseline = JSON.parse(JSON.stringify(config)) as PluginConfigLike

      await hooks.config?.(config as never)

      expect(config).toEqual(baseline)
    })
  })

  it("keeps config untouched when no catalog data is available", async () => {
    await withIsolatedHome(async () => {
      await seedAuthFixture(Date.now() + 60_000)
      stubGlobalForTest(
        "fetch",
        vi.fn(async (url: string | URL | Request) => {
          const endpoint =
            typeof url === "string" ? url : url instanceof URL ? url.toString() : new URL(url.url).toString()
          if (endpoint.includes("/backend-api/codex/models")) {
            throw new Error("network down")
          }
          if (endpoint.includes("raw.githubusercontent.com/openai/codex/")) {
            return new Response(JSON.stringify({ models: [] }), { status: 200 })
          }
          return new Response("ok", { status: 200 })
        })
      )

      const { CodexAuthPlugin } = await import("../lib/codex-native")
      const hooks = await CodexAuthPlugin({} as never)
      const config = makeConfig()
      const baseline = JSON.parse(JSON.stringify(config)) as PluginConfigLike

      await hooks.config?.(config as never)

      expect(config).toEqual(baseline)
    })
  })

  it("adds selectable custom models to provider config when their targets exist", async () => {
    await withIsolatedHome(async () => {
      await seedAuthFixture(Date.now() + 60_000)
      stubGlobalForTest(
        "fetch",
        vi.fn(async (url: string | URL | Request) => {
          const endpoint =
            typeof url === "string" ? url : url instanceof URL ? url.toString() : new URL(url.url).toString()
          if (endpoint.includes("/backend-api/codex/models")) {
            return new Response(
              JSON.stringify({
                models: [
                  {
                    slug: "gpt-5.4",
                    context_window: 272000,
                    input_modalities: ["text", "image"],
                    supported_reasoning_levels: [{ effort: "medium" }, { effort: "high" }]
                  }
                ]
              }),
              { status: 200 }
            )
          }
          if (endpoint.includes("raw.githubusercontent.com/openai/codex/")) {
            return new Response(JSON.stringify({ models: [] }), { status: 200 })
          }
          return new Response("ok", { status: 200 })
        })
      )

      const { CodexAuthPlugin } = await import("../lib/codex-native")
      const hooks = await CodexAuthPlugin({} as never, {
        customModels: {
          "openai/my-fast-codex": {
            targetModel: "gpt-5.4",
            name: "My Fast Codex",
            reasoningSummary: "concise"
          }
        }
      })
      const config = makeConfig()

      await hooks.config?.(config as never)

      expect(config.provider.openai.models["openai/my-fast-codex"]).toBeDefined()
      expect(config.provider.openai.models["openai/my-fast-codex"].name).toBe("My Fast Codex")
      expect(config.provider.openai.models["openai/my-fast-codex"].api).toMatchObject({
        id: "gpt-5.4"
      })
      expect(config.provider.openai.models["openai/my-fast-codex"].variants.high).toEqual({
        reasoningEffort: "high",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"]
      })
    })
  })
})
