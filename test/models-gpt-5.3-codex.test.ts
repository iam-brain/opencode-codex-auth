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

  it("preserves existing provider models when both the endpoint and github fallback are unavailable", async () => {
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

      expect(provider.models["gpt-5.2-codex"]).toEqual({ instructions: "TEMPLATE" })
      expect(provider.models["gpt-5.3-codex"]).toBeUndefined()
      expect(provider.models["o3-mini"]).toEqual({ id: "o3-mini" })
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

  it("applies the bootstrapped selected catalog to the first native-mode request", async () => {
    vi.resetModules()

    await withIsolatedHome(async () => {
      await seedAuthFixture(Date.now() + 60_000)
      let outboundInstructions = ""
      let outboundReasoning: { effort?: string; summary?: string } | undefined
      let outboundText: { verbosity?: string } | undefined
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
            reasoning?: { effort?: string; summary?: string }
            text?: { verbosity?: string }
            parallel_tool_calls?: boolean
          }
          outboundInstructions = body.instructions ?? ""
          outboundReasoning = body.reasoning
          outboundText = body.text
          outboundParallelToolCalls = body.parallel_tool_calls
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

      const paramsOutput = {
        temperature: 0,
        topP: 1,
        topK: 0,
        options: {} as Record<string, unknown>
      }
      await hooks["chat.params"]?.(
        {
          sessionID: "ses_switch_scope",
          model: {
            ...(provider.models["gpt-5.3-codex"] as Record<string, unknown>),
            id: "gpt-5.3-codex",
            api: { id: "gpt-5.3-codex" },
            providerID: "openai",
            capabilities: { toolcall: true }
          },
          agent: "default",
          message: {}
        } as any,
        paramsOutput as any
      )

      const headersOutput = { headers: {} as Record<string, unknown> }
      await hooks["chat.headers"]?.(
        {
          sessionID: "ses_native_waits",
          agent: "default",
          model: {
            providerID: "openai"
          }
        } as any,
        headersOutput as any
      )
      const headers = new Headers(headersOutput.headers as HeadersInit)
      headers.set("content-type", "application/json")

      const response = await loaded.fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "gpt-5.3-codex",
          instructions: "Native account instructions",
          reasoning: { effort: "high" },
          text: { verbosity: "medium" },
          parallel_tool_calls: false,
          input: "hello"
        })
      })

      expect(response.status).toBe(200)
      expect(paramsOutput.options.instructions).toBe("Native account instructions")
      expect(paramsOutput.options.reasoningEffort).toBe("high")
      expect(paramsOutput.options.reasoningSummary).toBeUndefined()
      expect(paramsOutput.options.textVerbosity).toBe("medium")
      expect(paramsOutput.options.parallelToolCalls).toBe(false)
      expect(outboundInstructions).toBe("Native account instructions")
      expect(outboundReasoning).toEqual({ effort: "high" })
      expect(outboundText).toEqual({ verbosity: "medium" })
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
      let outboundReasoning: { effort?: string; summary?: string } | undefined
      let outboundText: { verbosity?: string } | undefined
      let outboundParallelToolCalls: boolean | undefined
      let outboundInclude: string[] | undefined
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
            const reasoningSummaryFormat = accountId === secondAccountId ? "concise" : "auto"
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
                    supports_reasoning_summaries: true,
                    reasoning_summary_format: reasoningSummaryFormat,
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
            reasoning?: { effort?: string; summary?: string }
            text?: { verbosity?: string }
            parallel_tool_calls?: boolean
            include?: string[]
          }
          outboundInstructions = body.instructions ?? ""
          outboundReasoning = body.reasoning
          outboundText = body.text
          outboundParallelToolCalls = body.parallel_tool_calls
          outboundInclude = body.include
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

      const staleParamsOutput = {
        temperature: 0,
        topP: 1,
        topK: 0,
        options: {} as Record<string, unknown>
      }
      await hooks["chat.params"]?.(
        {
          sessionID: "ses_switch_scope",
          model: {
            ...(provider.models["gpt-5.3-codex"] as Record<string, unknown>),
            id: "gpt-5.3-codex",
            api: { id: "gpt-5.3-codex" },
            providerID: "openai",
            capabilities: { toolcall: true }
          },
          agent: "default",
          message: {}
        } as any,
        staleParamsOutput as any
      )

      const headersOutput = { headers: {} as Record<string, unknown> }
      await hooks["chat.headers"]?.(
        {
          sessionID: "ses_switch_scope",
          agent: "default",
          model: {
            providerID: "openai"
          }
        } as any,
        headersOutput as any
      )
      const headers = new Headers(headersOutput.headers as HeadersInit)
      headers.set("content-type", "application/json")

      if (!loaded.fetch) throw new Error("Missing loaded fetch")
      const response = await loaded.fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "gpt-5.3-codex",
          instructions: staleParamsOutput.options.instructions,
          reasoning: {
            effort: staleParamsOutput.options.reasoningEffort,
            summary: staleParamsOutput.options.reasoningSummary
          },
          text: { verbosity: staleParamsOutput.options.textVerbosity },
          parallel_tool_calls: staleParamsOutput.options.parallelToolCalls,
          include: ["reasoning.encrypted_content"],
          input: "hello"
        })
      })

      const nextParamsOutput = {
        temperature: 0,
        topP: 1,
        topK: 0,
        options: {} as Record<string, unknown>
      }
      await hooks["chat.params"]?.(
        {
          sessionID: "ses_switch_scope",
          model: {
            ...(provider.models["gpt-5.3-codex"] as Record<string, unknown>),
            id: "gpt-5.3-codex",
            api: { id: "gpt-5.3-codex" },
            providerID: "openai",
            capabilities: { toolcall: true }
          },
          agent: "default",
          message: {}
        } as any,
        nextParamsOutput as any
      )

      expect(response.status).toBe(200)
      expect(firstIdentityKey).not.toBe(secondIdentityKey)
      expect(firstAccess).not.toBe(secondAccess)
      expect(catalogRequestAccountIds).toContain(secondAccountId)
      expect(sawResponsesRequest).toBe(true)
      expect(staleParamsOutput.options.instructions).toContain("Instructions for account A")
      expect(staleParamsOutput.options.reasoningEffort).toBe("high")
      expect(staleParamsOutput.options.reasoningSummary).toBe("auto")
      expect(staleParamsOutput.options.textVerbosity).toBe("medium")
      expect(staleParamsOutput.options.parallelToolCalls).toBe(true)
      expect(outboundAuthorization).toBe(`Bearer ${secondAccess}`)
      expect(outboundAccountId).toBe(secondAccountId)
      expect(outboundInstructions).toContain("Instructions for account B")
      expect(outboundInstructions).not.toContain("Instructions for account A")
      expect(outboundReasoning).toEqual({ effort: "low", summary: "concise" })
      expect(outboundText).toEqual({ verbosity: "low" })
      expect(outboundParallelToolCalls).toBe(false)
      expect(outboundInclude).toEqual(["reasoning.encrypted_content"])
      expect(provider.models["gpt-5.3-codex"]?.instructions).toBe("Instructions for account B")
      expect(nextParamsOutput.options.instructions).toContain("Instructions for account B")
      expect(nextParamsOutput.options.reasoningEffort).toBe("low")
      expect(nextParamsOutput.options.reasoningSummary).toBe("concise")
      expect(nextParamsOutput.options.textVerbosity).toBe("low")
      expect(nextParamsOutput.options.parallelToolCalls).toBe(false)
    })
  })

  it("keeps the original session scope when another request switches the active catalog before headers run", async () => {
    vi.resetModules()

    await withIsolatedHome(async () => {
      const expires = Date.now() + 60_000
      const { firstAccountId, secondAccountId, secondIdentityKey, secondAccess } =
        await seedSwitchableAuthFixture(expires)

      let originalOutboundInstructions = ""
      let originalOutboundReasoning: { effort?: string; summary?: string } | undefined
      let originalOutboundText: { verbosity?: string } | undefined
      let originalOutboundParallelToolCalls: boolean | undefined
      let originalOutboundInclude: string[] | undefined
      let originalOutboundAccountId = ""
      let originalOutboundAuthorization = ""
      let sawInterleavingRequest = false
      const originalSessionID = "ses_scope_race_original"
      const interleavingSessionID = "ses_scope_race_other"

      stubGlobalForTest(
        "fetch",
        vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
          const endpoint =
            typeof url === "string" ? url : url instanceof URL ? url.toString() : new URL(url.url).toString()

          if (endpoint.includes("/backend-api/codex/models")) {
            const headers = url instanceof Request ? url.headers : new Headers(init?.headers)
            const accountId = headers.get("chatgpt-account-id") ?? ""
            const instructions =
              accountId === secondAccountId ? "Instructions for account B" : "Instructions for account A"
            const defaultReasoningLevel = accountId === secondAccountId ? "low" : "high"
            const reasoningSummaryFormat = accountId === secondAccountId ? "concise" : "auto"
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
                    supports_reasoning_summaries: true,
                    reasoning_summary_format: reasoningSummaryFormat,
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
          const sessionID = request.headers.get("session_id") ?? ""
          if (sessionID === interleavingSessionID) {
            sawInterleavingRequest = true
            return new Response("ok", { status: 200 })
          }

          if (sessionID !== originalSessionID) {
            return new Response("ok", { status: 200 })
          }

          originalOutboundAuthorization = request.headers.get("authorization") ?? ""
          originalOutboundAccountId = request.headers.get("chatgpt-account-id") ?? ""
          const body = JSON.parse(await request.text()) as {
            instructions?: string
            reasoning?: { effort?: string; summary?: string }
            text?: { verbosity?: string }
            parallel_tool_calls?: boolean
            include?: string[]
          }
          originalOutboundInstructions = body.instructions ?? ""
          originalOutboundReasoning = body.reasoning
          originalOutboundText = body.text
          originalOutboundParallelToolCalls = body.parallel_tool_calls
          originalOutboundInclude = body.include
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
      if (!loaded.fetch) throw new Error("Missing loaded fetch")

      const staleParamsOutput = {
        temperature: 0,
        topP: 1,
        topK: 0,
        options: {} as Record<string, unknown>
      }
      await hooks["chat.params"]?.(
        {
          sessionID: originalSessionID,
          model: {
            ...(provider.models["gpt-5.3-codex"] as Record<string, unknown>),
            id: "gpt-5.3-codex",
            api: { id: "gpt-5.3-codex" },
            providerID: "openai",
            capabilities: { toolcall: true }
          },
          agent: "default",
          message: {}
        } as any,
        staleParamsOutput as any
      )

      const authPath = path.join(process.env.XDG_CONFIG_HOME ?? "", "opencode", "codex-accounts.json")
      const raw = await fs.readFile(authPath, "utf8")
      const auth = JSON.parse(raw) as {
        openai?: { activeIdentityKey?: string; accounts?: Array<{ identityKey?: string }> }
      }
      if (!auth.openai?.accounts) throw new Error("Missing account fixture")
      auth.openai.activeIdentityKey = secondIdentityKey
      await fs.writeFile(authPath, JSON.stringify(auth, null, 2), "utf8")

      const interleavingParamsOutput = {
        temperature: 0,
        topP: 1,
        topK: 0,
        options: {} as Record<string, unknown>
      }
      await hooks["chat.params"]?.(
        {
          sessionID: interleavingSessionID,
          model: {
            ...(provider.models["gpt-5.3-codex"] as Record<string, unknown>),
            id: "gpt-5.3-codex",
            api: { id: "gpt-5.3-codex" },
            providerID: "openai",
            capabilities: { toolcall: true }
          },
          agent: "default",
          message: {}
        } as any,
        interleavingParamsOutput as any
      )

      const interleavingHeadersOutput = { headers: {} as Record<string, unknown> }
      await hooks["chat.headers"]?.(
        {
          sessionID: interleavingSessionID,
          agent: "default",
          model: {
            providerID: "openai"
          }
        } as any,
        interleavingHeadersOutput as any
      )
      const interleavingHeaders = new Headers(interleavingHeadersOutput.headers as HeadersInit)
      interleavingHeaders.set("content-type", "application/json")

      await loaded.fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: interleavingHeaders,
        body: JSON.stringify({
          model: "gpt-5.3-codex",
          instructions: interleavingParamsOutput.options.instructions,
          reasoning: {
            effort: interleavingParamsOutput.options.reasoningEffort,
            summary: interleavingParamsOutput.options.reasoningSummary
          },
          text: { verbosity: interleavingParamsOutput.options.textVerbosity },
          parallel_tool_calls: interleavingParamsOutput.options.parallelToolCalls,
          include: ["reasoning.encrypted_content"],
          input: "warm scope switch"
        })
      })

      const originalHeadersOutput = { headers: {} as Record<string, unknown> }
      await hooks["chat.headers"]?.(
        {
          sessionID: originalSessionID,
          agent: "default",
          model: {
            providerID: "openai"
          }
        } as any,
        originalHeadersOutput as any
      )
      expect(originalHeadersOutput.headers["x-opencode-catalog-scope-key"]).toBe(`account:${firstAccountId}`)

      const originalHeaders = new Headers(originalHeadersOutput.headers as HeadersInit)
      originalHeaders.set("content-type", "application/json")

      const response = await loaded.fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: originalHeaders,
        body: JSON.stringify({
          model: "gpt-5.3-codex",
          instructions: staleParamsOutput.options.instructions,
          reasoning: {
            effort: staleParamsOutput.options.reasoningEffort,
            summary: staleParamsOutput.options.reasoningSummary
          },
          text: { verbosity: staleParamsOutput.options.textVerbosity },
          parallel_tool_calls: staleParamsOutput.options.parallelToolCalls,
          include: ["reasoning.encrypted_content"],
          input: "hello"
        })
      })

      expect(response.status).toBe(200)
      expect(sawInterleavingRequest).toBe(true)
      expect(staleParamsOutput.options.instructions).toContain("Instructions for account A")
      expect(staleParamsOutput.options.reasoningEffort).toBe("high")
      expect(staleParamsOutput.options.reasoningSummary).toBe("auto")
      expect(staleParamsOutput.options.textVerbosity).toBe("medium")
      expect(staleParamsOutput.options.parallelToolCalls).toBe(true)
      expect(originalOutboundAuthorization).toBe(`Bearer ${secondAccess}`)
      expect(originalOutboundAccountId).toBe(secondAccountId)
      expect(originalOutboundInstructions).toContain("Instructions for account B")
      expect(originalOutboundInstructions).not.toContain("Instructions for account A")
      expect(originalOutboundReasoning).toEqual({ effort: "low", summary: "concise" })
      expect(originalOutboundText).toEqual({ verbosity: "low" })
      expect(originalOutboundParallelToolCalls).toBe(false)
      expect(originalOutboundInclude).toEqual(["reasoning.encrypted_content"])
    })
  })

  it("strips stale account-scoped defaults when the selected account catalog cannot be refreshed", async () => {
    vi.resetModules()

    await withIsolatedHome(async () => {
      const expires = Date.now() + 60_000
      const { secondAccountId, secondIdentityKey, secondAccess } = await seedSwitchableAuthFixture(expires)

      let outboundInstructions: string | undefined
      let outboundReasoning: { effort?: string; summary?: string } | undefined
      let outboundText: { verbosity?: string } | undefined
      let outboundParallelToolCalls: boolean | undefined
      let outboundInclude: string[] | undefined
      let outboundAccountId = ""
      let outboundAuthorization = ""

      stubGlobalForTest(
        "fetch",
        vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
          const endpoint =
            typeof url === "string" ? url : url instanceof URL ? url.toString() : new URL(url.url).toString()

          if (endpoint.includes("/backend-api/codex/models")) {
            const headers = url instanceof Request ? url.headers : new Headers(init?.headers)
            const accountId = headers.get("chatgpt-account-id") ?? ""
            if (accountId === secondAccountId) {
              throw new Error("account b catalog offline")
            }
            return new Response(
              JSON.stringify({
                models: [
                  {
                    slug: "gpt-5.3-codex",
                    context_window: 272000,
                    input_modalities: ["text"],
                    default_reasoning_level: "high",
                    supports_reasoning_summaries: true,
                    reasoning_summary_format: "auto",
                    default_verbosity: "medium",
                    supports_parallel_tool_calls: true,
                    model_messages: {
                      instructions_template: "Instructions for account A"
                    }
                  }
                ]
              }),
              { status: 200 }
            )
          }

          if (endpoint.includes("raw.githubusercontent.com/openai/codex/")) {
            throw new Error("github fallback offline")
          }

          const request = url as Request
          outboundAuthorization = request.headers.get("authorization") ?? ""
          outboundAccountId = request.headers.get("chatgpt-account-id") ?? ""
          const body = JSON.parse(await request.text()) as {
            instructions?: string
            reasoning?: { effort?: string; summary?: string }
            text?: { verbosity?: string }
            parallel_tool_calls?: boolean
            include?: string[]
          }
          outboundInstructions = body.instructions
          outboundReasoning = body.reasoning
          outboundText = body.text
          outboundParallelToolCalls = body.parallel_tool_calls
          outboundInclude = body.include
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

      const staleParamsOutput = {
        temperature: 0,
        topP: 1,
        topK: 0,
        options: {} as Record<string, unknown>
      }
      await hooks["chat.params"]?.(
        {
          sessionID: "ses_switch_scope_refresh_fail",
          model: {
            ...(provider.models["gpt-5.3-codex"] as Record<string, unknown>),
            id: "gpt-5.3-codex",
            api: { id: "gpt-5.3-codex" },
            providerID: "openai",
            capabilities: { toolcall: true }
          },
          agent: "default",
          message: {}
        } as any,
        staleParamsOutput as any
      )

      const authPath = path.join(process.env.XDG_CONFIG_HOME ?? "", "opencode", "codex-accounts.json")
      const raw = await fs.readFile(authPath, "utf8")
      const auth = JSON.parse(raw) as {
        openai?: { activeIdentityKey?: string; accounts?: Array<{ identityKey?: string }> }
      }
      if (!auth.openai?.accounts) throw new Error("Missing account fixture")
      auth.openai.activeIdentityKey = secondIdentityKey
      await fs.writeFile(authPath, JSON.stringify(auth, null, 2), "utf8")

      const headersOutput = { headers: {} as Record<string, unknown> }
      await hooks["chat.headers"]?.(
        {
          sessionID: "ses_switch_scope_refresh_fail",
          agent: "default",
          model: {
            providerID: "openai"
          }
        } as any,
        headersOutput as any
      )
      const headers = new Headers(headersOutput.headers as HeadersInit)
      headers.set("content-type", "application/json")

      if (!loaded.fetch) throw new Error("Missing loaded fetch")
      const response = await loaded.fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "gpt-5.3-codex",
          instructions: staleParamsOutput.options.instructions,
          reasoning: {
            effort: staleParamsOutput.options.reasoningEffort,
            summary: staleParamsOutput.options.reasoningSummary
          },
          text: { verbosity: staleParamsOutput.options.textVerbosity },
          parallel_tool_calls: staleParamsOutput.options.parallelToolCalls,
          include: ["reasoning.encrypted_content"],
          input: "hello"
        })
      })

      expect(response.status).toBe(200)
      expect(staleParamsOutput.options.instructions).toBe("Instructions for account A")
      expect(staleParamsOutput.options.reasoningEffort).toBe("high")
      expect(staleParamsOutput.options.reasoningSummary).toBe("auto")
      expect(staleParamsOutput.options.textVerbosity).toBe("medium")
      expect(staleParamsOutput.options.parallelToolCalls).toBe(true)
      expect(outboundAuthorization).toBe(`Bearer ${secondAccess}`)
      expect(outboundAccountId).toBe(secondAccountId)
      expect(outboundInstructions).toBeUndefined()
      expect(outboundReasoning).toBeUndefined()
      expect(outboundText).toBeUndefined()
      expect(outboundParallelToolCalls).toBeUndefined()
      expect(outboundInclude).toBeUndefined()
    })
  })
})
