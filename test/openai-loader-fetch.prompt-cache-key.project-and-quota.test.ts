import { afterEach, describe, expect, it, vi } from "vitest"
import { resetStubbedGlobals, stubGlobalForTest } from "./helpers/mock-policy"

afterEach(() => {
  resetStubbedGlobals()
})

async function loadHandlerWithAuth(auth: {
  access: string
  accountId: string
  identityKey: string
  email: string
  plan: string
  accountLabel: string
}) {
  const acquireOpenAIAuth = vi.fn(async () => auth)
  vi.doMock("../lib/codex-native/acquire-auth", () => ({
    acquireOpenAIAuth
  }))

  const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
  const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
  const { createStickySessionState } = await import("../lib/rotation")
  return {
    acquireOpenAIAuth,
    createOpenAIFetchHandler,
    createFetchOrchestratorState,
    createStickySessionState
  }
}

describe("openai loader fetch prompt cache key (project + quota)", () => {
  it("supports project-scoped prompt_cache_key override", async () => {
    vi.resetModules()

    const auth = {
      access: "access-token",
      accountId: "acc_123",
      identityKey: "acc_123|user@example.com|plus",
      email: "user@example.com",
      plan: "plus",
      accountLabel: "user@example.com (plus)"
    }

    const { acquireOpenAIAuth, createOpenAIFetchHandler, createFetchOrchestratorState, createStickySessionState } =
      await loadHandlerWithAuth(auth)
    const outboundKeys: string[] = []
    stubGlobalForTest(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const request = input as Request
        const outboundBody = JSON.parse(await request.text()) as Record<string, unknown>
        if (typeof outboundBody.prompt_cache_key === "string") {
          outboundKeys.push(outboundBody.prompt_cache_key)
        }
        return new Response("ok", { status: 200 })
      })
    )

    const createHandler = (projectPath: string) =>
      createOpenAIFetchHandler({
        authMode: "native",
        spoofMode: "native",
        promptCacheKeyStrategy: "project",
        projectPath,
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

    const projectAHandler = createHandler("/tmp/example-project")
    const projectBHandler = createHandler("/tmp/example-project-2")

    await projectAHandler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "ses_original_a"
      },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: "hello",
        prompt_cache_key: "ses_original_a"
      })
    })

    await projectAHandler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "ses_original_b"
      },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: "hello",
        prompt_cache_key: "ses_original_b"
      })
    })

    await projectBHandler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "ses_original_c"
      },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: "hello",
        prompt_cache_key: "ses_original_c"
      })
    })

    expect(acquireOpenAIAuth).toHaveBeenCalled()
    expect(outboundKeys).toHaveLength(3)
    expect(outboundKeys[0]).toMatch(/^ocpk_v1_[a-f0-9]{24}$/)
    expect(outboundKeys[1]).toBe(outboundKeys[0])
    expect(outboundKeys[2]).toMatch(/^ocpk_v1_[a-f0-9]{24}$/)
    expect(outboundKeys[2]).not.toBe(outboundKeys[0])
  })

  it("warns and cools down account when weekly quota is exhausted", async () => {
    vi.resetModules()

    const auth = {
      access: "access-token",
      accountId: "acc_123",
      identityKey: "acc_123|user@example.com|plus",
      email: "user@example.com",
      plan: "plus",
      accountLabel: "user@example.com (plus)"
    }

    const { createOpenAIFetchHandler, createFetchOrchestratorState, createStickySessionState } =
      await loadHandlerWithAuth(auth)

    const primaryResetAt = Date.now() + 15 * 60 * 1000
    const weeklyResetAt = Date.now() + 90 * 60 * 1000
    let apiCallCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes("/wham/usage")) {
        return new Response(
          JSON.stringify({
            rate_limit: {
              primary_window: {
                used_percent: 20,
                reset_at: primaryResetAt
              },
              secondary_window: {
                used_percent: 100,
                reset_at: weeklyResetAt
              }
            }
          }),
          { status: 200 }
        )
      }

      apiCallCount += 1
      return new Response("ok", { status: 200 })
    })
    stubGlobalForTest("fetch", fetchMock)

    const setCooldown = vi.fn(async () => {})
    const showToast = vi.fn(async (_message: string, _variant?: string, _quietMode?: boolean) => {})
    const log = { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }
    const handler = createOpenAIFetchHandler({
      authMode: "native",
      spoofMode: "native",
      remapDeveloperMessagesToUserEnabled: false,
      quietMode: false,
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
      setCooldown,
      showToast,
      log
    })

    await handler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "ses_quota_1"
      },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: "hello",
        prompt_cache_key: "ses_quota_1"
      })
    })

    expect(apiCallCount).toBe(1)
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/wham/usage"))).toBe(true)
      expect(log.debug).not.toHaveBeenCalledWith(
        "quota refresh during request failed",
        expect.objectContaining({ identityKey: auth.identityKey })
      )
      expect(setCooldown).toHaveBeenCalledWith(auth.identityKey, weeklyResetAt)
      expect(
        showToast.mock.calls.some(
          (call) => call[0] === "Switching account due to weekly quota limit" && call[1] === "warning"
        )
      ).toBe(true)
    })
  })

  it("does not emit weekly exhaustion toast when only 5h quota is exhausted", async () => {
    vi.resetModules()

    const auth = {
      access: "access-token",
      accountId: "acc_123",
      identityKey: "acc_123|user@example.com|plus",
      email: "user@example.com",
      plan: "plus",
      accountLabel: "user@example.com (plus)"
    }

    const { createOpenAIFetchHandler, createFetchOrchestratorState, createStickySessionState } =
      await loadHandlerWithAuth(auth)
    const fiveHourResetAt = Date.now() + 30 * 60 * 1000

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes("/wham/usage")) {
        return new Response(
          JSON.stringify({
            rate_limit: {
              primary_window: {
                used_percent: 100,
                reset_at: fiveHourResetAt
              },
              secondary_window: {
                used_percent: 45,
                reset_at: Date.now() + 60 * 60 * 1000
              }
            }
          }),
          { status: 200 }
        )
      }

      return new Response("ok", { status: 200 })
    })
    stubGlobalForTest("fetch", fetchMock)

    const setCooldown = vi.fn(async () => {})
    const showToast = vi.fn(async (_message: string, _variant?: string, _quietMode?: boolean) => {})
    const handler = createOpenAIFetchHandler({
      authMode: "native",
      spoofMode: "native",
      remapDeveloperMessagesToUserEnabled: false,
      quietMode: false,
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
      setCooldown,
      showToast
    })

    await handler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "ses_quota_5h_only"
      },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: "hello"
      })
    })

    await vi.waitFor(() => {
      expect(setCooldown).toHaveBeenCalledWith(auth.identityKey, fiveHourResetAt)
      expect(showToast.mock.calls.some((call) => String(call[0]).includes("weekly quota limit"))).toBe(false)
      expect(showToast.mock.calls.some((call) => String(call[0]).includes("5h quota limit"))).toBe(true)
    })
  })

  it("does not block response on quota refresh", async () => {
    vi.resetModules()

    const auth = {
      access: "access-token",
      accountId: "acc_123",
      identityKey: "acc_123|user@example.com|plus",
      email: "user@example.com",
      plan: "plus",
      accountLabel: "user@example.com (plus)"
    }

    const { createOpenAIFetchHandler, createFetchOrchestratorState, createStickySessionState } =
      await loadHandlerWithAuth(auth)

    let resolveQuota: ((response: Response) => void) | undefined
    const quotaPending = new Promise<Response>((resolve) => {
      resolveQuota = resolve
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes("/wham/usage")) {
        return quotaPending
      }
      return new Response("ok", { status: 200 })
    })
    stubGlobalForTest("fetch", fetchMock)

    const setCooldown = vi.fn(async () => {})
    const showToast = vi.fn(async (_message: string, _variant?: string, _quietMode?: boolean) => {})
    const handler = createOpenAIFetchHandler({
      authMode: "native",
      spoofMode: "native",
      remapDeveloperMessagesToUserEnabled: false,
      quietMode: false,
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
      setCooldown,
      showToast
    })

    const handlerPromise = handler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "ses_async_quota"
      },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: "hello"
      })
    })

    const response = await handlerPromise
    expect(response.status).toBe(200)

    resolveQuota?.(
      new Response(
        JSON.stringify({
          rate_limit: {
            primary_window: { used_percent: 10, reset_at: Date.now() + 10 * 60 * 1000 },
            secondary_window: { used_percent: 100, reset_at: Date.now() + 60 * 60 * 1000 }
          }
        }),
        { status: 200 }
      )
    )

    await vi.waitFor(() => {
      expect(setCooldown).toHaveBeenCalled()
      expect(showToast).toHaveBeenCalled()
    })
  })
})
