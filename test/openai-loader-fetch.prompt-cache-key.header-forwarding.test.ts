import { afterEach, describe, expect, it, vi } from "vitest"
import { resetStubbedGlobals, stubGlobalForTest } from "./helpers/mock-policy"

afterEach(() => {
  resetStubbedGlobals()
})

describe("openai loader fetch prompt cache key (header forwarding)", () => {
  it("preserves allowed inbound originator in native mode", async () => {
    vi.resetModules()

    const acquireOpenAIAuth = vi.fn(async () => ({
      access: "access-token",
      accountId: "acc_123",
      identityKey: "acc_123|user@example.com|plus"
    }))
    vi.doMock("../lib/codex-native/acquire-auth", () => ({ acquireOpenAIAuth }))

    const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
    const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
    const { createStickySessionState } = await import("../lib/rotation")

    let capturedOriginator = ""
    stubGlobalForTest(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes("/wham/usage")) {
          return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
        }
        const request = input as Request
        capturedOriginator = request.headers.get("originator") ?? ""
        return new Response("ok", { status: 200 })
      })
    )

    const handler = createOpenAIFetchHandler({
      authMode: "native",
      spoofMode: "native",
      remapDeveloperMessagesToUserEnabled: false,
      quietMode: true,
      pidOffsetEnabled: false,
      headerTransformDebug: false,
      compatInputSanitizerEnabled: false,
      internalCollaborationModeHeader: "x-opencode-collaboration-mode-kind",
      requestSnapshots: {
        captureRequest: async () => {},
        captureResponse: async () => {}
      },
      sessionAffinityState: {
        orchestratorState: createFetchOrchestratorState(),
        stickySessionState: createStickySessionState(),
        hybridSessionState: createStickySessionState(),
        persistSessionAffinityState: () => {}
      },
      getCatalogModels: () => undefined,
      syncCatalogFromAuth: async () => undefined,
      setCooldown: async () => {},
      showToast: async () => {}
    })

    await handler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        originator: "codex_exec"
      },
      body: JSON.stringify({ model: "gpt-5.3-codex", input: "hello" })
    })

    expect(acquireOpenAIAuth).toHaveBeenCalled()
    expect(capturedOriginator).toBe("codex_exec")
  })

  it("preserves allowed inbound originator in codex mode", async () => {
    vi.resetModules()

    const prevArgv = process.argv
    process.argv = ["node", "opencode"]

    try {
      const acquireOpenAIAuth = vi.fn(async () => ({
        access: "access-token",
        accountId: "acc_123",
        identityKey: "acc_123|user@example.com|plus"
      }))
      vi.doMock("../lib/codex-native/acquire-auth", () => ({ acquireOpenAIAuth }))

      const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
      const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
      const { createStickySessionState } = await import("../lib/rotation")

      let capturedOriginator = ""
      stubGlobalForTest(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
          if (url.includes("/wham/usage")) {
            return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
          }
          const request = input as Request
          capturedOriginator = request.headers.get("originator") ?? ""
          return new Response("ok", { status: 200 })
        })
      )

      const handler = createOpenAIFetchHandler({
        authMode: "codex",
        spoofMode: "codex",
        remapDeveloperMessagesToUserEnabled: false,
        quietMode: true,
        pidOffsetEnabled: false,
        headerTransformDebug: false,
        compatInputSanitizerEnabled: false,
        internalCollaborationModeHeader: "x-opencode-collaboration-mode-kind",
        requestSnapshots: {
          captureRequest: async () => {},
          captureResponse: async () => {}
        },
        sessionAffinityState: {
          orchestratorState: createFetchOrchestratorState(),
          stickySessionState: createStickySessionState(),
          hybridSessionState: createStickySessionState(),
          persistSessionAffinityState: () => {}
        },
        getCatalogModels: () => undefined,
        syncCatalogFromAuth: async () => undefined,
        setCooldown: async () => {},
        showToast: async () => {}
      })

      await handler("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          originator: "opencode"
        },
        body: JSON.stringify({ model: "gpt-5.3-codex", input: "hello" })
      })

      expect(acquireOpenAIAuth).toHaveBeenCalled()
      expect(capturedOriginator).toBe("opencode")
    } finally {
      process.argv = prevArgv
    }
  })

  it("preserves inbound user-agent in native mode", async () => {
    vi.resetModules()

    const acquireOpenAIAuth = vi.fn(async () => ({
      access: "access-token",
      accountId: "acc_123",
      identityKey: "acc_123|user@example.com|plus"
    }))
    vi.doMock("../lib/codex-native/acquire-auth", () => ({ acquireOpenAIAuth }))

    const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
    const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
    const { createStickySessionState } = await import("../lib/rotation")

    const inboundUserAgent = "a".repeat(600)
    let capturedUserAgent = ""
    stubGlobalForTest(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes("/wham/usage")) {
          return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
        }
        const request = input as Request
        capturedUserAgent = request.headers.get("user-agent") ?? ""
        return new Response("ok", { status: 200 })
      })
    )

    const handler = createOpenAIFetchHandler({
      authMode: "native",
      spoofMode: "native",
      remapDeveloperMessagesToUserEnabled: false,
      quietMode: true,
      pidOffsetEnabled: false,
      headerTransformDebug: false,
      compatInputSanitizerEnabled: false,
      internalCollaborationModeHeader: "x-opencode-collaboration-mode-kind",
      requestSnapshots: {
        captureRequest: async () => {},
        captureResponse: async () => {}
      },
      sessionAffinityState: {
        orchestratorState: createFetchOrchestratorState(),
        stickySessionState: createStickySessionState(),
        hybridSessionState: createStickySessionState(),
        persistSessionAffinityState: () => {}
      },
      getCatalogModels: () => undefined,
      syncCatalogFromAuth: async () => undefined,
      setCooldown: async () => {},
      showToast: async () => {}
    })

    await handler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": inboundUserAgent
      },
      body: JSON.stringify({ model: "gpt-5.3-codex", input: "hello" })
    })

    expect(acquireOpenAIAuth).toHaveBeenCalled()
    expect(capturedUserAgent).toBe(inboundUserAgent)
  })

  it("retains custom inbound headers on forwarded request", async () => {
    vi.resetModules()

    const acquireOpenAIAuth = vi.fn(async () => ({
      access: "access-token",
      accountId: "acc_123",
      identityKey: "acc_123|user@example.com|plus"
    }))
    vi.doMock("../lib/codex-native/acquire-auth", () => ({ acquireOpenAIAuth }))

    const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
    const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
    const { createStickySessionState } = await import("../lib/rotation")

    let capturedCustomHeader: string | null = null
    stubGlobalForTest(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes("/wham/usage")) {
          return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
        }
        const request = input as Request
        capturedCustomHeader = request.headers.get("x-custom")
        return new Response("ok", { status: 200 })
      })
    )

    const handler = createOpenAIFetchHandler({
      authMode: "native",
      spoofMode: "native",
      remapDeveloperMessagesToUserEnabled: false,
      quietMode: true,
      pidOffsetEnabled: false,
      headerTransformDebug: false,
      compatInputSanitizerEnabled: false,
      internalCollaborationModeHeader: "x-opencode-collaboration-mode-kind",
      requestSnapshots: {
        captureRequest: async () => {},
        captureResponse: async () => {}
      },
      sessionAffinityState: {
        orchestratorState: createFetchOrchestratorState(),
        stickySessionState: createStickySessionState(),
        hybridSessionState: createStickySessionState(),
        persistSessionAffinityState: () => {}
      },
      getCatalogModels: () => undefined,
      syncCatalogFromAuth: async () => undefined,
      setCooldown: async () => {},
      showToast: async () => {}
    })

    await handler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-custom": "kept"
      },
      body: JSON.stringify({ model: "gpt-5.3-codex", input: "hello" })
    })

    expect(acquireOpenAIAuth).toHaveBeenCalled()
    expect(capturedCustomHeader).toBe("kept")
  })

  it("strips unsafe forwarded headers before outbound fetch", async () => {
    vi.resetModules()

    const acquireOpenAIAuth = vi.fn(async () => ({
      access: "access-token",
      accountId: "acc_123",
      identityKey: "acc_123|user@example.com|plus"
    }))
    vi.doMock("../lib/codex-native/acquire-auth", () => ({ acquireOpenAIAuth }))

    const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
    const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
    const { createStickySessionState } = await import("../lib/rotation")

    let capturedCookie: string | null = null
    let capturedProxyAuth: string | null = null
    let capturedXForwardedFor: string | null = null
    stubGlobalForTest(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes("/wham/usage")) {
          return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
        }
        const request = input as Request
        capturedCookie = request.headers.get("cookie")
        capturedProxyAuth = request.headers.get("proxy-authorization")
        capturedXForwardedFor = request.headers.get("x-forwarded-for")
        return new Response("ok", { status: 200 })
      })
    )

    const handler = createOpenAIFetchHandler({
      authMode: "native",
      spoofMode: "native",
      remapDeveloperMessagesToUserEnabled: false,
      quietMode: true,
      pidOffsetEnabled: false,
      headerTransformDebug: false,
      compatInputSanitizerEnabled: false,
      internalCollaborationModeHeader: "x-opencode-collaboration-mode-kind",
      requestSnapshots: {
        captureRequest: async () => {},
        captureResponse: async () => {}
      },
      sessionAffinityState: {
        orchestratorState: createFetchOrchestratorState(),
        stickySessionState: createStickySessionState(),
        hybridSessionState: createStickySessionState(),
        persistSessionAffinityState: () => {}
      },
      getCatalogModels: () => undefined,
      syncCatalogFromAuth: async () => undefined,
      setCooldown: async () => {},
      showToast: async () => {}
    })

    await handler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "a=b",
        "proxy-authorization": "Basic abc",
        "x-forwarded-for": "127.0.0.1"
      },
      body: JSON.stringify({ model: "gpt-5.3-codex", input: "hello" })
    })

    expect(acquireOpenAIAuth).toHaveBeenCalled()
    expect(capturedCookie).toBeNull()
    expect(capturedProxyAuth).toBeNull()
    expect(capturedXForwardedFor).toBeNull()
  })
})
