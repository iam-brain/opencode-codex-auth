import { describe, expect, it, vi } from "vitest"

describe("codex-native snapshots", () => {
  it("persists rate-limit snapshot from response headers for the selected account", async () => {
    vi.resetModules()

    const auth = {
      openai: {
        type: "oauth",
        accounts: [
          {
            identityKey: "acc|u@e.com|plus",
            accountId: "acc",
            enabled: true,
            access: "at",
            refresh: "rt",
            expires: Date.now() + 60_000
          }
        ],
        activeIdentityKey: "acc|u@e.com|plus"
      }
    }

    const loadAuthStorage = vi.fn(async () => auth)

    const saveAuthStorage = vi.fn(async (
      _path: string | undefined,
      update: (auth: Record<string, unknown>) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void
    ) => {
      await update(auth)
      return auth
    })
    const setAccountCooldown = vi.fn(async () => {})
    const getOpenAIOAuthDomain = vi.fn((current: Record<string, unknown>, mode: "native" | "codex") => {
      const openai = current.openai as { accounts?: unknown[]; activeIdentityKey?: string } | undefined
      if (!openai || !Array.isArray(openai.accounts)) return undefined
      const scoped = (openai.accounts as Array<{ authTypes?: string[] }>).filter((account) => {
        const authTypes = Array.isArray(account.authTypes) ? account.authTypes : ["native"]
        return authTypes.includes(mode)
      })
      if (scoped.length === 0) return undefined
      return { accounts: scoped, activeIdentityKey: openai.activeIdentityKey }
    })
    const ensureOpenAIOAuthDomain = vi.fn((current: Record<string, unknown>, mode: "native" | "codex") => {
      const existing = getOpenAIOAuthDomain(current, mode)
      if (existing) return existing
      return { accounts: [] }
    })
    const listOpenAIOAuthDomains = vi.fn((current: Record<string, unknown>) =>
      (["native", "codex"] as const)
        .map((mode) => ({ mode, domain: getOpenAIOAuthDomain(current, mode) }))
        .filter(
          (entry): entry is { mode: "native" | "codex"; domain: { accounts: unknown[] } } =>
            Boolean(entry.domain && Array.isArray(entry.domain.accounts))
        )
    )
    const saveSnapshots = vi.fn(async (_path: string, update: (current: Record<string, unknown>) => Record<string, unknown>) => {
      return update({})
    })

    vi.doMock("../lib/storage", () => ({
      loadAuthStorage,
      saveAuthStorage,
      getOpenAIOAuthDomain,
      ensureOpenAIOAuthDomain,
      listOpenAIOAuthDomains,
      setAccountCooldown,
      shouldOfferLegacyTransfer: vi.fn(async () => false)
    }))
    vi.doMock("../lib/codex-status-storage", () => ({
      saveSnapshots
    }))

    vi.stubGlobal("fetch", vi.fn(async () => {
      return new Response("ok", {
        status: 200,
        headers: {
          "x-ratelimit-remaining-requests": "75",
          "x-ratelimit-limit-requests": "100",
          "x-ratelimit-reset-requests": "1700"
        }
      })
    }))

    const { CodexAuthPlugin } = await import("../lib/codex-native")
    const hooks = await CodexAuthPlugin({} as never)
    const loader = hooks.auth?.loader
    if (!loader) throw new Error("Missing auth loader")

    const provider = {
      models: {
        "gpt-5.2-codex": { id: "gpt-5.2-codex" }
      }
    }

    const loaded = await loader(
      async () => ({ type: "oauth", refresh: "", access: "", expires: 0 } as never),
      provider as never
    )

    await loaded.fetch?.("https://api.openai.com/v1/responses", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.2-codex", input: "hi" })
    })

    expect(saveSnapshots).toHaveBeenCalledTimes(1)
  })

  it("rewrites inbound SDK user-agent to codex-style in codex mode before outbound fetch", async () => {
    vi.resetModules()

    const auth = {
      openai: {
        type: "oauth",
        accounts: [
          {
            identityKey: "acc|u@e.com|plus",
            accountId: "acc",
            enabled: true,
            access: "at",
            refresh: "rt",
            expires: Date.now() + 60_000,
            authTypes: ["codex"]
          }
        ],
        activeIdentityKey: "acc|u@e.com|plus"
      }
    }

    const loadAuthStorage = vi.fn(async () => auth)
    const saveAuthStorage = vi.fn(async (
      _path: string | undefined,
      update: (auth: Record<string, unknown>) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void
    ) => {
      await update(auth)
      return auth
    })

    const setAccountCooldown = vi.fn(async () => {})
    const getOpenAIOAuthDomain = vi.fn((current: Record<string, unknown>, mode: "native" | "codex") => {
      const openai = current.openai as { accounts?: unknown[]; activeIdentityKey?: string } | undefined
      if (!openai || !Array.isArray(openai.accounts)) return undefined
      const scoped = (openai.accounts as Array<{ authTypes?: string[] }>).filter((account) => {
        const authTypes = Array.isArray(account.authTypes) ? account.authTypes : ["native"]
        return authTypes.includes(mode)
      })
      if (scoped.length === 0) return undefined
      return { accounts: scoped, activeIdentityKey: openai.activeIdentityKey }
    })
    const ensureOpenAIOAuthDomain = vi.fn((current: Record<string, unknown>, mode: "native" | "codex") => {
      const existing = getOpenAIOAuthDomain(current, mode)
      if (existing) return existing
      return { accounts: [] }
    })
    const listOpenAIOAuthDomains = vi.fn((current: Record<string, unknown>) =>
      (["native", "codex"] as const)
        .map((mode) => ({ mode, domain: getOpenAIOAuthDomain(current, mode) }))
        .filter(
          (entry): entry is { mode: "native" | "codex"; domain: { accounts: unknown[] } } =>
            Boolean(entry.domain && Array.isArray(entry.domain.accounts))
        )
    )

    vi.doMock("../lib/storage", () => ({
      loadAuthStorage,
      saveAuthStorage,
      getOpenAIOAuthDomain,
      ensureOpenAIOAuthDomain,
      listOpenAIOAuthDomains,
      setAccountCooldown,
      shouldOfferLegacyTransfer: vi.fn(async () => false)
    }))
    vi.doMock("../lib/codex-status-storage", () => ({
      saveSnapshots: vi.fn(async (_path: string, update: (current: Record<string, unknown>) => Record<string, unknown>) =>
        update({})
      )
    }))

    let capturedUserAgent = ""
    let capturedOriginator = ""
    let capturedSessionId = ""
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request
      capturedUserAgent = request.headers.get("user-agent") ?? ""
      capturedOriginator = request.headers.get("originator") ?? ""
      capturedSessionId = request.headers.get("session_id") ?? ""
      return new Response("ok", { status: 200 })
    }))

    const { CodexAuthPlugin } = await import("../lib/codex-native")
    const hooks = await CodexAuthPlugin({} as never, { spoofMode: "codex" })
    const loader = hooks.auth?.loader
    if (!loader) throw new Error("Missing auth loader")

    const provider = {
      models: {
        "gpt-5.2-codex": { id: "gpt-5.2-codex" }
      }
    }

    const loaded = await loader(
      async () => ({ type: "oauth", refresh: "", access: "", expires: 0 } as never),
      provider as never
    )

    const sdkLikeInbound = new Request("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        originator: "codex_exec",
        "user-agent": "opencode-codex-auth (...) ai-sdk/provider-utils/3.0.20 runtime/bun/1.3.5",
        session_id: "ses_codex_fetch_1"
      },
      body: JSON.stringify({ model: "gpt-5.2-codex", input: "hi" })
    })

    await loaded.fetch?.(sdkLikeInbound)

    expect(capturedOriginator).toBe("codex_exec")
    expect(capturedUserAgent).toMatch(/^codex_exec\//)
    expect(capturedUserAgent).not.toContain("ai-sdk/provider-utils")
    expect(capturedSessionId).toBe("ses_codex_fetch_1")
  })

  it("preserves native originator/user-agent/session_id in native mode before outbound fetch", async () => {
    vi.resetModules()

    const auth = {
      openai: {
        type: "oauth",
        accounts: [
          {
            identityKey: "acc|u@e.com|plus",
            accountId: "acc",
            enabled: true,
            access: "at",
            refresh: "rt",
            expires: Date.now() + 60_000,
            authTypes: ["native"]
          }
        ],
        activeIdentityKey: "acc|u@e.com|plus"
      }
    }

    const loadAuthStorage = vi.fn(async () => auth)
    const saveAuthStorage = vi.fn(async (
      _path: string | undefined,
      update: (auth: Record<string, unknown>) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void
    ) => {
      await update(auth)
      return auth
    })
    const setAccountCooldown = vi.fn(async () => {})
    const getOpenAIOAuthDomain = vi.fn((current: Record<string, unknown>, mode: "native" | "codex") => {
      const openai = current.openai as { accounts?: unknown[]; activeIdentityKey?: string } | undefined
      if (!openai || !Array.isArray(openai.accounts)) return undefined
      const scoped = (openai.accounts as Array<{ authTypes?: string[] }>).filter((account) => {
        const authTypes = Array.isArray(account.authTypes) ? account.authTypes : ["native"]
        return authTypes.includes(mode)
      })
      if (scoped.length === 0) return undefined
      return { accounts: scoped, activeIdentityKey: openai.activeIdentityKey }
    })
    const ensureOpenAIOAuthDomain = vi.fn((current: Record<string, unknown>, mode: "native" | "codex") => {
      const existing = getOpenAIOAuthDomain(current, mode)
      if (existing) return existing
      return { accounts: [] }
    })
    const listOpenAIOAuthDomains = vi.fn((current: Record<string, unknown>) =>
      (["native", "codex"] as const)
        .map((mode) => ({ mode, domain: getOpenAIOAuthDomain(current, mode) }))
        .filter(
          (entry): entry is { mode: "native" | "codex"; domain: { accounts: unknown[] } } =>
            Boolean(entry.domain && Array.isArray(entry.domain.accounts))
        )
    )

    vi.doMock("../lib/storage", () => ({
      loadAuthStorage,
      saveAuthStorage,
      getOpenAIOAuthDomain,
      ensureOpenAIOAuthDomain,
      listOpenAIOAuthDomains,
      setAccountCooldown,
      shouldOfferLegacyTransfer: vi.fn(async () => false)
    }))
    vi.doMock("../lib/codex-status-storage", () => ({
      saveSnapshots: vi.fn(async (_path: string, update: (current: Record<string, unknown>) => Record<string, unknown>) =>
        update({})
      )
    }))

    let capturedUserAgent = ""
    let capturedOriginator = ""
    let capturedSessionId = ""
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request
      capturedUserAgent = request.headers.get("user-agent") ?? ""
      capturedOriginator = request.headers.get("originator") ?? ""
      capturedSessionId = request.headers.get("session_id") ?? ""
      return new Response("ok", { status: 200 })
    }))

    const { CodexAuthPlugin } = await import("../lib/codex-native")
    const hooks = await CodexAuthPlugin({} as never, { spoofMode: "native" })
    const loader = hooks.auth?.loader
    if (!loader) throw new Error("Missing auth loader")

    const provider = {
      models: {
        "gpt-5.2-codex": { id: "gpt-5.2-codex" }
      }
    }

    const loaded = await loader(
      async () => ({ type: "oauth", refresh: "", access: "", expires: 0 } as never),
      provider as never
    )

    const sdkLikeInbound = new Request("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        originator: "opencode",
        "user-agent": "opencode/1.2.3 (Darwin)",
        session_id: "ses_native_fetch_1"
      },
      body: JSON.stringify({ model: "gpt-5.2-codex", input: "hi" })
    })

    await loaded.fetch?.(sdkLikeInbound)

    expect(capturedOriginator).toBe("opencode")
    expect(capturedUserAgent).toBe("opencode/1.2.3 (Darwin)")
    expect(capturedSessionId).toBe("ses_native_fetch_1")
  })

  it("captures collaboration mode in snapshot metadata but strips internal debug header before outbound fetch", async () => {
    vi.resetModules()

    const auth = {
      openai: {
        type: "oauth",
        accounts: [
          {
            identityKey: "acc|u@e.com|plus",
            accountId: "acc",
            enabled: true,
            access: "at",
            refresh: "rt",
            expires: Date.now() + 60_000,
            authTypes: ["codex"]
          }
        ],
        activeIdentityKey: "acc|u@e.com|plus"
      }
    }

    const loadAuthStorage = vi.fn(async () => auth)
    const saveAuthStorage = vi.fn(async (
      _path: string | undefined,
      update: (auth: Record<string, unknown>) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void
    ) => {
      await update(auth)
      return auth
    })
    const setAccountCooldown = vi.fn(async () => {})
    const getOpenAIOAuthDomain = vi.fn((current: Record<string, unknown>, mode: "native" | "codex") => {
      const openai = current.openai as { accounts?: unknown[]; activeIdentityKey?: string } | undefined
      if (!openai || !Array.isArray(openai.accounts)) return undefined
      const scoped = (openai.accounts as Array<{ authTypes?: string[] }>).filter((account) => {
        const authTypes = Array.isArray(account.authTypes) ? account.authTypes : ["native"]
        return authTypes.includes(mode)
      })
      if (scoped.length === 0) return undefined
      return { accounts: scoped, activeIdentityKey: openai.activeIdentityKey }
    })
    const ensureOpenAIOAuthDomain = vi.fn((current: Record<string, unknown>, mode: "native" | "codex") => {
      const existing = getOpenAIOAuthDomain(current, mode)
      if (existing) return existing
      return { accounts: [] }
    })
    const listOpenAIOAuthDomains = vi.fn((current: Record<string, unknown>) =>
      (["native", "codex"] as const)
        .map((mode) => ({ mode, domain: getOpenAIOAuthDomain(current, mode) }))
        .filter(
          (entry): entry is { mode: "native" | "codex"; domain: { accounts: unknown[] } } =>
            Boolean(entry.domain && Array.isArray(entry.domain.accounts))
        )
    )

    vi.doMock("../lib/storage", () => ({
      loadAuthStorage,
      saveAuthStorage,
      getOpenAIOAuthDomain,
      ensureOpenAIOAuthDomain,
      listOpenAIOAuthDomains,
      setAccountCooldown,
      shouldOfferLegacyTransfer: vi.fn(async () => false)
    }))
    vi.doMock("../lib/codex-status-storage", () => ({
      saveSnapshots: vi.fn(async (_path: string, update: (current: Record<string, unknown>) => Record<string, unknown>) =>
        update({})
      )
    }))

    const captureRequest = vi.fn(async () => {})
    const captureResponse = vi.fn(async () => {})
    const createRequestSnapshots = vi.fn(() => ({
      captureRequest,
      captureResponse
    }))
    vi.doMock("../lib/request-snapshots", () => ({
      createRequestSnapshots
    }))

    let seenInternalHeader = ""
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request
      seenInternalHeader = request.headers.get("x-opencode-collaboration-mode-kind") ?? ""
      return new Response("ok", { status: 200 })
    }))

    const { CodexAuthPlugin } = await import("../lib/codex-native")
    const hooks = await CodexAuthPlugin({} as never, {
      spoofMode: "codex",
      headerTransformDebug: true
    })
    const loader = hooks.auth?.loader
    if (!loader) throw new Error("Missing auth loader")

    const provider = {
      models: {
        "gpt-5.2-codex": { id: "gpt-5.2-codex" }
      }
    }

    const loaded = await loader(
      async () => ({ type: "oauth", refresh: "", access: "", expires: 0 } as never),
      provider as never
    )

    await loaded.fetch?.("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        originator: "codex_cli_rs",
        "x-opencode-collaboration-mode-kind": "plan"
      },
      body: JSON.stringify({ model: "gpt-5.2-codex", input: "hi" })
    })

    expect(createRequestSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true
      })
    )
    const beforeTransformCall = captureRequest.mock.calls.find(
      (call) => call[0] === "before-header-transform"
    )
    const afterTransformCall = captureRequest.mock.calls.find(
      (call) => call[0] === "after-header-transform"
    )
    const beforeAuthCall = captureRequest.mock.calls.find((call) => call[0] === "before-auth")
    expect(beforeTransformCall).toBeDefined()
    expect(afterTransformCall?.[2]?.collaborationModeKind).toBe("plan")
    expect(beforeAuthCall?.[2]?.collaborationModeKind).toBe("plan")
    expect(seenInternalHeader).toBe("")
  })
})
