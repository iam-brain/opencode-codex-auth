import { afterEach, describe, expect, it, vi } from "vitest"
import { resetStubbedGlobals, stubGlobalForTest } from "./helpers/mock-policy"

afterEach(() => {
  resetStubbedGlobals()
})

describe("openai loader fetch prompt cache key (core behavior)", () => {
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
    stubGlobalForTest(
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
    expect(outboundBody).toEqual(
      expect.objectContaining({
        model: "gpt-5.3-codex",
        prompt_cache_key: "ses_original"
      })
    )
    expect(outboundAttemptMeta?.attemptReasonCode).toBe("initial_attempt")
    expect(outboundAttemptMeta?.selectionDecision).toBeUndefined()
    expect(outboundAttemptMeta?.selectionStrategy).toBeUndefined()
    expect(outboundAttemptMeta?.selectionEligibleCount).toBeUndefined()
    expect(outboundAttemptMeta?.selectionTotalCount).toBeUndefined()
    expect(outboundAttemptMeta?.selectionDisabledCount).toBeUndefined()
    expect(outboundAttemptMeta?.selectionRefreshLeaseCount).toBeUndefined()
  })

  it("does not mutate shared affinity maps for subagent-marked requests", async () => {
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

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => {
        return new Response("ok", { status: 200 })
      })
    )

    const orchestratorState = createFetchOrchestratorState()
    const now = Date.now()
    orchestratorState.seenSessionKeys.set("ses_parent", now)
    orchestratorState.seenSessionKeys.set("ses_subagent", now)
    const stickySessionState = createStickySessionState()
    stickySessionState.bySessionKey.set("ses_parent", auth.identityKey)
    stickySessionState.bySessionKey.set("ses_subagent", auth.identityKey)
    const hybridSessionState = createStickySessionState()
    hybridSessionState.bySessionKey.set("ses_parent", auth.identityKey)
    hybridSessionState.bySessionKey.set("ses_subagent", auth.identityKey)
    const persistSessionAffinityState = vi.fn()

    const handler = createOpenAIFetchHandler({
      authMode: "native",
      spoofMode: "native",
      remapDeveloperMessagesToUserEnabled: false,
      quietMode: true,
      pidOffsetEnabled: false,
      headerTransformDebug: false,
      compatInputSanitizerEnabled: false,
      internalCollaborationModeHeader: "x-opencode-collaboration-mode-kind",
      internalCollaborationAgentHeader: "x-openai-subagent",
      requestSnapshots: {
        captureRequest: async () => {},
        captureResponse: async () => {}
      },
      sessionAffinityState: {
        orchestratorState,
        stickySessionState,
        hybridSessionState,
        persistSessionAffinityState
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
        "x-openai-subagent": "plan",
        session_id: "ses_subagent"
      },
      body: JSON.stringify({ model: "gpt-5.3-codex", input: "hi" })
    })

    expect(orchestratorState.seenSessionKeys.get("ses_parent")).toBe(now)
    expect((orchestratorState.seenSessionKeys.get("ses_subagent") ?? 0) >= now).toBe(true)
    expect(stickySessionState.bySessionKey.get("ses_parent")).toBe(auth.identityKey)
    expect(stickySessionState.bySessionKey.get("ses_subagent")).toBe(auth.identityKey)
    expect(hybridSessionState.bySessionKey.get("ses_parent")).toBe(auth.identityKey)
    expect(hybridSessionState.bySessionKey.get("ses_subagent")).toBe(auth.identityKey)
    expect(persistSessionAffinityState).not.toHaveBeenCalled()
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
    stubGlobalForTest(
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
})
