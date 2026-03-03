import { afterEach, describe, expect, it, vi } from "vitest"
import { resetStubbedGlobals, stubGlobalForTest } from "./helpers/mock-policy"

afterEach(() => {
  resetStubbedGlobals()
})

describe("openai loader fetch prompt cache key (catalog refresh)", () => {
  it("returns disallowed_outbound_request for invalid outbound request input", async () => {
    vi.resetModules()

    const acquireOpenAIAuth = vi.fn(async () => ({
      access: "access-token",
      accountId: "acc_123",
      identityKey: "acc_123|user@example.com|plus"
    }))
    vi.doMock("../lib/codex-native/acquire-auth", () => ({
      acquireOpenAIAuth
    }))

    const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
    const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
    const { createStickySessionState } = await import("../lib/rotation")

    const fetchSpy = vi.fn(async () => new Response("ok", { status: 200 }))
    stubGlobalForTest("fetch", fetchSpy)

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

    const response = await handler("not a valid outbound url")
    const payload = (await response.json()) as { error?: { type?: string } }
    expect(response.status).toBe(400)
    expect(payload.error?.type).toBe("disallowed_outbound_request")
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(acquireOpenAIAuth).not.toHaveBeenCalled()
  })

  it("dedupes catalog refresh across concurrent requests for the same account scope", async () => {
    vi.resetModules()

    const auth = {
      access: "access-token",
      accountId: "acc_shared_scope",
      identityKey: "acc_shared_scope|user@example.com|plus"
    }
    const acquireOpenAIAuth = vi.fn(async () => auth)
    vi.doMock("../lib/codex-native/acquire-auth", () => ({ acquireOpenAIAuth }))

    const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
    const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
    const { createStickySessionState } = await import("../lib/rotation")

    let releaseCatalogSync: (() => void) | undefined
    const catalogSyncGate = new Promise<void>((resolve) => {
      releaseCatalogSync = resolve
    })
    const syncCatalogFromAuth = vi.fn(async () => {
      await catalogSyncGate
      return undefined
    })

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => {
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
      syncCatalogFromAuth,
      setCooldown: async () => {},
      showToast: async () => {}
    })

    const first = handler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_catalog_1" },
      body: JSON.stringify({ model: "gpt-5.3-codex", input: "one" })
    })
    const second = handler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_catalog_2" },
      body: JSON.stringify({ model: "gpt-5.3-codex", input: "two" })
    })

    await vi.waitFor(() => {
      expect(syncCatalogFromAuth).toHaveBeenCalledTimes(1)
    })

    releaseCatalogSync?.()
    await Promise.all([first, second])

    await handler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_catalog_3" },
      body: JSON.stringify({ model: "gpt-5.3-codex", input: "three" })
    })
    expect(syncCatalogFromAuth).toHaveBeenCalledTimes(1)
  })

  it("retries catalog sync after failure once failure retry window elapses", async () => {
    vi.resetModules()

    const auth = {
      access: "access-token",
      accountId: "acc_shared_scope",
      identityKey: "acc_shared_scope|user@example.com|plus"
    }
    const acquireOpenAIAuth = vi.fn(async () => auth)
    vi.doMock("../lib/codex-native/acquire-auth", () => ({ acquireOpenAIAuth }))

    const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
    const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
    const { createStickySessionState } = await import("../lib/rotation")

    let syncCalls = 0
    const syncCatalogFromAuth = vi.fn(async () => {
      syncCalls += 1
      if (syncCalls === 1) {
        throw new Error("sync failed once")
      }
      return undefined
    })

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => {
        return new Response("ok", { status: 200 })
      })
    )

    let nowValue = 1_000
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => nowValue)

    try {
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
        syncCatalogFromAuth,
        setCooldown: async () => {},
        showToast: async () => {}
      })

      await handler("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", session_id: "ses_catalog_1" },
        body: JSON.stringify({ model: "gpt-5.3-codex", input: "one" })
      })

      nowValue = 12_000
      await handler("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", session_id: "ses_catalog_2" },
        body: JSON.stringify({ model: "gpt-5.3-codex", input: "two" })
      })

      expect(syncCatalogFromAuth).toHaveBeenCalledTimes(2)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it("isolates catalog refresh scopes for identityless auth using attempt keys", async () => {
    vi.resetModules()

    const auths = [
      {
        access: "access-token-1",
        selectionTrace: { attemptKey: "idx:1" }
      },
      {
        access: "access-token-2",
        selectionTrace: { attemptKey: "idx:2" }
      }
    ]
    const acquireOpenAIAuth = vi.fn(async () => {
      const next = auths.shift()
      if (!next) throw new Error("missing auth mock")
      return next
    })
    vi.doMock("../lib/codex-native/acquire-auth", () => ({ acquireOpenAIAuth }))

    const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
    const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
    const { createStickySessionState } = await import("../lib/rotation")

    const syncCatalogFromAuth = vi.fn(async () => undefined)

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => {
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
      syncCatalogFromAuth,
      setCooldown: async () => {},
      showToast: async () => {}
    })

    await Promise.all([
      handler("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", session_id: "ses_catalog_anonymous_1" },
        body: JSON.stringify({ model: "gpt-5.3-codex", input: "one" })
      }),
      handler("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", session_id: "ses_catalog_anonymous_2" },
        body: JSON.stringify({ model: "gpt-5.3-codex", input: "two" })
      })
    ])

    expect(syncCatalogFromAuth).toHaveBeenCalledTimes(2)
  })
})
