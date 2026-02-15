import { describe, expect, it, vi } from "vitest"

describe("openai loader fetch prompt cache key", () => {
  it("keeps upstream prompt_cache_key behavior by default", async () => {
    vi.resetModules()

    const auth = {
      access: "access-token",
      accountId: "acc_123",
      identityKey: "acc_123|user@example.com|plus",
      email: "user@example.com",
      plan: "plus",
      accountLabel: "user@example.com (plus)"
    }

    const acquireOpenAIAuth = vi.fn(async () => auth)
    vi.doMock("../lib/codex-native/acquire-auth", () => ({
      acquireOpenAIAuth
    }))

    const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
    const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
    const { createStickySessionState } = await import("../lib/rotation")
    let outboundBody: Record<string, unknown> | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const request = input as Request
        outboundBody = JSON.parse(await request.text()) as Record<string, unknown>
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
        session_id: "ses_original"
      },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: "hello",
        prompt_cache_key: "ses_original"
      })
    })

    expect(acquireOpenAIAuth).toHaveBeenCalled()
    expect(outboundBody).toBeDefined()
    expect(outboundBody?.prompt_cache_key).toBe("ses_original")
  })

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

    const acquireOpenAIAuth = vi.fn(async () => auth)
    vi.doMock("../lib/codex-native/acquire-auth", () => ({
      acquireOpenAIAuth
    }))

    const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
    const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
    const { createStickySessionState } = await import("../lib/rotation")
    const { buildProjectPromptCacheKey } = await import("../lib/prompt-cache-key")

    let outboundBody: Record<string, unknown> | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const request = input as Request
        outboundBody = JSON.parse(await request.text()) as Record<string, unknown>
        return new Response("ok", { status: 200 })
      })
    )

    const projectPath = "/tmp/example-project"
    const handler = createOpenAIFetchHandler({
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

    await handler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "ses_original"
      },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: "hello",
        prompt_cache_key: "ses_original"
      })
    })

    expect(acquireOpenAIAuth).toHaveBeenCalled()
    expect(outboundBody).toBeDefined()
    expect(outboundBody?.prompt_cache_key).toBe(
      buildProjectPromptCacheKey({
        projectPath,
        spoofMode: "native"
      })
    )
  })
})
