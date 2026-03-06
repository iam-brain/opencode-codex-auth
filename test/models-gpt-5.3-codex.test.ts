import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { resetStubbedGlobals, stubGlobalForTest } from "./helpers/mock-policy"

import { afterEach, describe, expect, it, vi } from "vitest"

async function withIsolatedHome<T>(fn: () => Promise<T>): Promise<T> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-models-home-"))
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
    if (prevHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = prevHome
    }
    if (prevXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = prevXdg
    }
    if (prevXdgCache === undefined) {
      delete process.env.XDG_CACHE_HOME
    } else {
      process.env.XDG_CACHE_HOME = prevXdgCache
    }
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

async function seedSwitchableAuthFixture(expires: number): Promise<{
  firstAccountId: string
  secondAccountId: string
  firstIdentityKey: string
  secondIdentityKey: string
  firstAccess: string
  secondAccess: string
}> {
  const fixturePath = path.join(process.cwd(), "test", "fixtures", "auth-multi.json")
  const raw = await fs.readFile(fixturePath, "utf8")
  const parsed = JSON.parse(raw) as {
    openai?: {
      strategy?: string
      activeIdentityKey?: string
      accounts?: Array<{
        enabled?: boolean
        refresh?: string
        access?: string
        expires?: number
        accountId?: string
        email?: string
        plan?: string
        identityKey?: string
        authTypes?: string[]
      }>
    }
  }
  const base = parsed.openai?.accounts?.[0]
  if (!base || !parsed.openai) {
    throw new Error("Missing multi-account fixture seed")
  }

  const firstAccountId = "acc_123"
  const secondAccountId = "acc_456"
  const firstAccess = "at_123"
  const secondAccess = "at_456"
  const firstEmail = "user@example.com"
  const secondEmail = "user+alt@example.com"
  const firstIdentityKey = `${firstAccountId}|${firstEmail}|plus`
  const secondIdentityKey = `${secondAccountId}|${secondEmail}|plus`

  parsed.openai.strategy = "sticky"
  parsed.openai.accounts = [
    {
      ...base,
      expires,
      access: firstAccess,
      refresh: "rt_123",
      accountId: firstAccountId,
      email: firstEmail,
      plan: "plus",
      identityKey: firstIdentityKey,
      authTypes: ["codex"]
    },
    {
      ...base,
      expires,
      access: secondAccess,
      refresh: "rt_456",
      accountId: secondAccountId,
      email: secondEmail,
      plan: "plus",
      identityKey: secondIdentityKey,
      authTypes: ["codex"]
    }
  ]
  parsed.openai.activeIdentityKey = firstIdentityKey

  const authPath = path.join(process.env.XDG_CONFIG_HOME ?? "", "opencode", "codex-accounts.json")
  await fs.mkdir(path.dirname(authPath), { recursive: true })
  await fs.writeFile(authPath, JSON.stringify(parsed, null, 2), "utf8")

  return {
    firstAccountId,
    secondAccountId,
    firstIdentityKey,
    secondIdentityKey,
    firstAccess,
    secondAccess
  }
}

describe("codex-native model allowlist", () => {
  afterEach(() => {
    resetStubbedGlobals()
    vi.resetModules()
  })

  it("clears provider models when both the endpoint and github fallback are unavailable", async () => {
    vi.resetModules()

    await withIsolatedHome(async () => {
      await seedAuthFixture(Date.now() + 60_000)
      stubGlobalForTest(
        "fetch",
        vi.fn(async () => {
          throw new Error("network down")
        })
      )

      const { CodexAuthPlugin } = await import("../lib/codex-native")
      const hooks = await CodexAuthPlugin({} as any)
      const provider: { models: Record<string, { instructions?: string; id?: string }> } = {
        models: {
          "gpt-5.2-codex": { instructions: "TEMPLATE" },
          "o3-mini": { id: "o3-mini" }
        }
      }

      const loader = hooks.auth?.loader
      if (!loader) throw new Error("Missing auth loader")

      await loader(async () => ({ type: "oauth", refresh: "", access: "", expires: 0 }) as any, provider as any)

      expect(provider.models["gpt-5.2-codex"]).toBeUndefined()
      expect(provider.models["gpt-5.3-codex"]).toBeUndefined()
      expect(provider.models["o3-mini"]).toBeUndefined()
    })
  })

  it("uses server catalog when available", async () => {
    vi.resetModules()

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
                  { slug: "gpt-5.4-codex", context_window: 272000, input_modalities: ["text", "image"] },
                  { slug: "gpt-5.4-codex-mini", context_window: 272000, input_modalities: ["text"] }
                ]
              }),
              { status: 200 }
            )
          }
          if (endpoint.includes("raw.githubusercontent.com/openai/codex/")) {
            return new Response(
              JSON.stringify({
                models: [
                  { slug: "gpt-5.4-codex", context_window: 272000, input_modalities: ["text", "image"] },
                  { slug: "gpt-5.4-codex-mini", context_window: 272000, input_modalities: ["text"] }
                ]
              }),
              { status: 200 }
            )
          }
          return new Response("ok", { status: 200 })
        })
      )

      const module = await import("../lib/codex-native")
      const hooks = await module.CodexAuthPlugin({} as any)

      const provider: { models: Record<string, { instructions?: string; id?: string }> } = {
        models: {
          "gpt-5.2-codex": { instructions: "TEMPLATE" },
          "o3-mini": { id: "o3-mini" }
        }
      }

      const loader = hooks.auth?.loader
      if (!loader) throw new Error("Missing auth loader")

      await loader(async () => ({ type: "oauth", refresh: "", access: "", expires: 0 }) as any, provider as any)

      expect(provider.models["gpt-5.4-codex"]).toBeDefined()
      expect(provider.models["gpt-5.4-codex-mini"]).toBeDefined()
      expect(provider.models["o3-mini"]).toBeUndefined()
    })
  })

  it("awaits the selected catalog before the first native-mode request for an uncached account", async () => {
    vi.resetModules()

    await withIsolatedHome(async () => {
      await seedAuthFixture(Date.now() + 60_000)
      let outboundInstructions = ""
      let outboundReasoningEffort = ""
      let outboundTextVerbosity = ""
      let outboundParallelToolCalls: boolean | undefined

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
                    slug: "gpt-5.3-codex",
                    context_window: 272000,
                    input_modalities: ["text"],
                    default_reasoning_level: "high",
                    default_verbosity: "medium",
                    supports_parallel_tool_calls: false,
                    model_messages: {
                      instructions_template: "Native account instructions"
                    }
                  }
                ]
              }),
              { status: 200 }
            )
          }
          if (endpoint.includes("raw.githubusercontent.com/openai/codex/")) {
            return new Response(
              JSON.stringify({
                models: [{ slug: "gpt-5.3-codex", context_window: 272000, input_modalities: ["text"] }]
              }),
              { status: 200 }
            )
          }

          const request = url as Request
          const body = JSON.parse(await request.text()) as {
            instructions?: string
            reasoningEffort?: string
            textVerbosity?: string
            parallelToolCalls?: boolean
          }
          outboundInstructions = body.instructions ?? ""
          outboundReasoningEffort = body.reasoningEffort ?? ""
          outboundTextVerbosity = body.textVerbosity ?? ""
          outboundParallelToolCalls = body.parallelToolCalls
          return new Response("ok", { status: 200 })
        })
      )

      const { CodexAuthPlugin } = await import("../lib/codex-native")
      const hooks = await CodexAuthPlugin({} as any, { spoofMode: "native" })
      const provider: { models: Record<string, { instructions?: string; id?: string }> } = {
        models: {
          "gpt-5.3-codex": { id: "gpt-5.3-codex" }
        }
      }

      const loader = hooks.auth?.loader
      if (!loader) throw new Error("Missing auth loader")

      const loaded = await loader(
        async () => ({ type: "oauth", refresh: "", access: "", expires: 0 }) as any,
        provider as any
      )
      if (!loaded.fetch) throw new Error("Missing loaded fetch")

      const response = await loaded.fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", session_id: "ses_native_waits" },
        body: JSON.stringify({ model: "gpt-5.3-codex", input: "hello" })
      })

      expect(response.status).toBe(200)
      expect(outboundInstructions).toBe("Native account instructions")
      expect(outboundReasoningEffort).toBe("high")
      expect(outboundTextVerbosity).toBe("medium")
      expect(outboundParallelToolCalls).toBe(false)
    })
  })

  it("uses the selected account catalog after bootstrap switches to a different account", async () => {
    vi.resetModules()

    await withIsolatedHome(async () => {
      const expires = Date.now() + 60_000
      const { secondAccountId, firstIdentityKey, secondIdentityKey, firstAccess, secondAccess } =
        await seedSwitchableAuthFixture(expires)

      let outboundInstructions = ""
      let outboundReasoningEffort = ""
      let outboundTextVerbosity = ""
      let outboundParallelToolCalls: boolean | undefined
      let outboundAccountId = ""
      let outboundAuthorization = ""
      let sawResponsesRequest = false
      const catalogRequestAccountIds: string[] = []
      stubGlobalForTest(
        "fetch",
        vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
          const endpoint =
            typeof url === "string" ? url : url instanceof URL ? url.toString() : new URL(url.url).toString()

          if (endpoint.includes("/backend-api/codex/models")) {
            const headers = url instanceof Request ? url.headers : new Headers(init?.headers)
            const accountId = headers.get("chatgpt-account-id") ?? ""
            if (accountId) {
              catalogRequestAccountIds.push(accountId)
            }
            const instructions =
              accountId === secondAccountId ? "Instructions for account B" : "Instructions for account A"
            const defaultReasoningLevel = accountId === secondAccountId ? "low" : "high"
            const defaultVerbosity = accountId === secondAccountId ? "low" : "medium"
            const supportsParallelToolCalls = accountId !== secondAccountId
            return new Response(
              JSON.stringify({
                models: [
                  {
                    slug: "gpt-5.3-codex",
                    context_window: 272000,
                    input_modalities: ["text"],
                    default_reasoning_level: defaultReasoningLevel,
                    default_verbosity: defaultVerbosity,
                    supports_parallel_tool_calls: supportsParallelToolCalls,
                    model_messages: {
                      instructions_template: instructions
                    }
                  }
                ]
              }),
              { status: 200 }
            )
          }

          if (endpoint.includes("raw.githubusercontent.com/openai/codex/")) {
            return new Response(
              JSON.stringify({
                models: [
                  {
                    slug: "gpt-5.3-codex",
                    context_window: 272000,
                    input_modalities: ["text"]
                  }
                ]
              }),
              { status: 200 }
            )
          }

          const request = url as Request
          sawResponsesRequest = true
          outboundAuthorization = request.headers.get("authorization") ?? ""
          outboundAccountId = request.headers.get("chatgpt-account-id") ?? ""
          const body = JSON.parse(await request.text()) as {
            instructions?: string
            reasoningEffort?: string
            textVerbosity?: string
            parallelToolCalls?: boolean
          }
          outboundInstructions = body.instructions ?? ""
          outboundReasoningEffort = body.reasoningEffort ?? ""
          outboundTextVerbosity = body.textVerbosity ?? ""
          outboundParallelToolCalls = body.parallelToolCalls
          return new Response("ok", { status: 200 })
        })
      )

      const { CodexAuthPlugin } = await import("../lib/codex-native")
      const hooks = await CodexAuthPlugin({} as any, { spoofMode: "codex" })
      const provider: { models: Record<string, { instructions?: string; id?: string }> } = {
        models: {
          "gpt-5.3-codex": { id: "gpt-5.3-codex" }
        }
      }

      const loader = hooks.auth?.loader
      if (!loader) throw new Error("Missing auth loader")

      const loaded = await loader(
        async () => ({ type: "oauth", refresh: "", access: "", expires: 0 }) as any,
        provider as any
      )

      const authPath = path.join(process.env.XDG_CONFIG_HOME ?? "", "opencode", "codex-accounts.json")
      const raw = await fs.readFile(authPath, "utf8")
      const auth = JSON.parse(raw) as {
        openai?: { activeIdentityKey?: string; accounts?: Array<{ identityKey?: string }> }
      }
      if (!auth.openai?.accounts) throw new Error("Missing account fixture")
      auth.openai.activeIdentityKey = secondIdentityKey
      await fs.writeFile(authPath, JSON.stringify(auth, null, 2), "utf8")

      if (!loaded.fetch) throw new Error("Missing loaded fetch")
      const response = await loaded.fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", session_id: "ses_switch_scope" },
        body: JSON.stringify({ model: "gpt-5.3-codex", input: "hello" })
      })

      expect(response.status).toBe(200)
      expect(firstIdentityKey).not.toBe(secondIdentityKey)
      expect(firstAccess).not.toBe(secondAccess)
      expect(catalogRequestAccountIds).toContain(secondAccountId)
      expect(sawResponsesRequest).toBe(true)
      expect(outboundAuthorization).toBe(`Bearer ${secondAccess}`)
      expect(outboundAccountId).toBe(secondAccountId)
      expect(outboundInstructions).toContain("Instructions for account B")
      expect(outboundInstructions).not.toContain("Instructions for account A")
      expect(outboundReasoningEffort).toBe("low")
      expect(outboundTextVerbosity).toBe("low")
      expect(outboundParallelToolCalls).toBe(false)
      expect(provider.models["gpt-5.3-codex"]?.instructions).toBe("Instructions for account B")
    })
  })
})
