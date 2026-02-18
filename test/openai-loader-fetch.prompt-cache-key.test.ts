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
      accountLabel: "user@example.com (plus)",
      selectionTrace: {
        strategy: "sticky",
        decision: "sticky-active",
        totalCount: 3,
        disabledCount: 1,
        cooldownCount: 0,
        refreshLeaseCount: 1,
        eligibleCount: 1,
        attemptedCount: 1
      }
    }

    const acquireOpenAIAuth = vi.fn(async () => auth)
    vi.doMock("../lib/codex-native/acquire-auth", () => ({
      acquireOpenAIAuth
    }))
    vi.doMock("../lib/codex-status-storage", () => ({
      saveSnapshots: vi.fn(
        async (_path: string, update: (current: Record<string, unknown>) => Record<string, unknown>) => update({})
      )
    }))

    const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
    const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
    const { createStickySessionState } = await import("../lib/rotation")
    let outboundBody: Record<string, unknown> | undefined
    let outboundAttemptMeta: Record<string, unknown> | undefined
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
        captureRequest: async (stage, _request, meta) => {
          if (stage === "outbound-attempt") {
            outboundAttemptMeta = meta
          }
        },
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
    expect(outboundAttemptMeta?.attemptReasonCode).toBe("initial_attempt")
    expect(outboundAttemptMeta?.selectionDecision).toBeUndefined()
    expect(outboundAttemptMeta?.selectionStrategy).toBeUndefined()
    expect(outboundAttemptMeta?.selectionEligibleCount).toBeUndefined()
    expect(outboundAttemptMeta?.selectionTotalCount).toBeUndefined()
    expect(outboundAttemptMeta?.selectionDisabledCount).toBeUndefined()
    expect(outboundAttemptMeta?.selectionRefreshLeaseCount).toBeUndefined()
  })

  it("includes selection telemetry in snapshots when header transform debug is enabled", async () => {
    vi.resetModules()

    const auth = {
      access: "access-token",
      accountId: "acc_123",
      identityKey: "acc_123|user@example.com|plus",
      email: "user@example.com",
      plan: "plus",
      accountLabel: "user@example.com (plus)",
      selectionTrace: {
        strategy: "sticky",
        decision: "sticky-active",
        totalCount: 3,
        disabledCount: 1,
        cooldownCount: 0,
        refreshLeaseCount: 1,
        eligibleCount: 1,
        attemptedCount: 1
      }
    }

    const acquireOpenAIAuth = vi.fn(async () => auth)
    vi.doMock("../lib/codex-native/acquire-auth", () => ({
      acquireOpenAIAuth
    }))

    const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
    const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
    const { createStickySessionState } = await import("../lib/rotation")

    let outboundAttemptMeta: Record<string, unknown> | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response("ok", { status: 200 })
      })
    )

    const handler = createOpenAIFetchHandler({
      authMode: "native",
      spoofMode: "native",
      remapDeveloperMessagesToUserEnabled: false,
      quietMode: true,
      pidOffsetEnabled: false,
      headerTransformDebug: true,
      compatInputSanitizerEnabled: false,
      internalCollaborationModeHeader: "x-opencode-collaboration-mode-kind",
      requestSnapshots: {
        captureRequest: async (stage, _request, meta) => {
          if (stage === "outbound-attempt") {
            outboundAttemptMeta = meta
          }
        },
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
        session_id: "ses_debug"
      },
      body: JSON.stringify({ model: "gpt-5.3-codex", input: "hello" })
    })

    expect(acquireOpenAIAuth).toHaveBeenCalled()
    expect(outboundAttemptMeta?.selectionDecision).toBe("sticky-active")
    expect(outboundAttemptMeta?.selectionStrategy).toBe("sticky")
    expect(outboundAttemptMeta?.selectionEligibleCount).toBe(1)
    expect(outboundAttemptMeta?.selectionTotalCount).toBe(3)
    expect(outboundAttemptMeta?.selectionDisabledCount).toBe(1)
    expect(outboundAttemptMeta?.selectionRefreshLeaseCount).toBe(1)
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

    const acquireOpenAIAuth = vi.fn(async () => auth)
    vi.doMock("../lib/codex-native/acquire-auth", () => ({
      acquireOpenAIAuth
    }))

    const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
    const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
    const { createStickySessionState } = await import("../lib/rotation")

    let apiCallCount = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (url.includes("/wham/usage")) {
        return new Response(
          JSON.stringify({
            rate_limit: {
              primary_window: {
                used_percent: 20,
                reset_at: 1_710_000_000
              },
              secondary_window: {
                used_percent: 100,
                reset_at: 1_711_000_000
              }
            }
          }),
          { status: 200 }
        )
      }

      apiCallCount += 1
      return new Response("ok", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

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
      expect(setCooldown).toHaveBeenCalledWith(auth.identityKey, expect.any(Number))
      expect(
        showToast.mock.calls.some(
          (call) => call[0] === "Switching account due to weekly quota limit" && call[1] === "warning"
        )
      ).toBe(true)
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

    const acquireOpenAIAuth = vi.fn(async () => auth)
    vi.doMock("../lib/codex-native/acquire-auth", () => ({
      acquireOpenAIAuth
    }))

    const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
    const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
    const { createStickySessionState } = await import("../lib/rotation")

    let resolveQuota: ((response: Response) => void) | undefined
    const quotaPending = new Promise<Response>((resolve) => {
      resolveQuota = resolve
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (url.includes("/wham/usage")) {
        return quotaPending
      }
      return new Response("ok", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

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

    const earlyResolution = await Promise.race<string>([
      handlerPromise.then(() => "resolved"),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 25))
    ])

    resolveQuota?.(
      new Response(
        JSON.stringify({
          rate_limit: {
            primary_window: { used_percent: 10, reset_at: 1_710_000_000 },
            secondary_window: { used_percent: 100, reset_at: 1_711_000_000 }
          }
        }),
        { status: 200 }
      )
    )

    await handlerPromise

    expect(earlyResolution).toBe("resolved")
    await vi.waitFor(() => {
      expect(setCooldown).toHaveBeenCalled()
      expect(showToast).toHaveBeenCalled()
    })
  })

  it("retries quota refresh sooner after failure instead of waiting full ttl", async () => {
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

    let usageCalls = 0
    let now = 1_700_000_000_000
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (url.includes("/wham/usage")) {
        usageCalls += 1
        throw new Error("quota backend down")
      }
      return new Response("ok", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const setCooldown = vi.fn(async () => {})
    const showToast = vi.fn(async () => {})
    const log = { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }
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
      setCooldown,
      showToast,
      log
    })

    await handler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "ses_quota_fail_1"
      },
      body: JSON.stringify({ model: "gpt-5.3-codex", input: "hello" })
    })

    await new Promise((resolve) => setTimeout(resolve, 20))

    await handler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "ses_quota_fail_2"
      },
      body: JSON.stringify({ model: "gpt-5.3-codex", input: "hello again" })
    })

    expect(usageCalls).toBe(1)

    now += 10_200

    await handler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "ses_quota_fail_3"
      },
      body: JSON.stringify({ model: "gpt-5.3-codex", input: "hello after retry window" })
    })

    await vi.waitFor(() => {
      expect(usageCalls).toBeGreaterThanOrEqual(2)
      expect(log.debug).toHaveBeenCalledWith(
        "quota fetch failed",
        expect.objectContaining({ endpoint: expect.stringContaining("/wham/usage") })
      )
    })

    nowSpy.mockRestore()
  })

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
    vi.stubGlobal(
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
      vi.stubGlobal(
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
    vi.stubGlobal(
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
    vi.stubGlobal(
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
})
