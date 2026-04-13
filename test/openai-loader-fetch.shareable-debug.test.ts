import { afterEach, describe, expect, it, vi } from "vitest"

import { resetStubbedGlobals, stubGlobalForTest } from "./helpers/mock-policy"

afterEach(() => {
  resetStubbedGlobals()
})

describe("openai loader shareable debug wiring", () => {
  it("emits request, retry, and response events", async () => {
    vi.resetModules()

    const auths = [
      {
        access: "access_1",
        identityKey: "acc_1|user1@example.com|plus",
        accountId: "acc_1",
        selectionTrace: {
          strategy: "sticky",
          selectedIdentityKey: "acc_1|user1@example.com|plus",
          activeIdentityKey: "acc_1|user1@example.com|plus"
        }
      },
      {
        access: "access_2",
        identityKey: "acc_2|user2@example.com|pro",
        accountId: "acc_2",
        selectionTrace: {
          strategy: "sticky",
          selectedIdentityKey: "acc_2|user2@example.com|pro",
          activeIdentityKey: "acc_2|user2@example.com|pro"
        }
      }
    ]
    let authIndex = 0
    const acquireOpenAIAuth = vi.fn(async () => auths[authIndex++])
    vi.doMock("../lib/codex-native/acquire-auth", () => ({
      acquireOpenAIAuth
    }))

    const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
    const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
    const { createStickySessionState } = await import("../lib/rotation")

    const shareableDebug = {
      enabled: true,
      emitRotationBegin: vi.fn(async () => {}),
      emitRotationDecision: vi.fn(async () => {}),
      emitRotationCandidateSelected: vi.fn(async () => {}),
      emitFetchAttemptRequest: vi.fn(async () => {}),
      emitFetchAttemptResponse: vi.fn(async () => {}),
      emitRetryAfter429: vi.fn(async () => {}),
      emitAuthFailure: vi.fn(async () => {}),
      emitSyntheticFatalError: vi.fn(async () => {})
    }

    let fetchCount = 0
    stubGlobalForTest(
      "fetch",
      vi.fn(async () => {
        fetchCount += 1
        if (fetchCount === 1) {
          return new Response("Rate limited", { status: 429, headers: { "Retry-After": "1" } })
        }
        return new Response("ok", { status: 200 })
      })
    )

    const handler = createOpenAIFetchHandler({
      authMode: "codex",
      spoofMode: "codex",
      remapDeveloperMessagesToUserEnabled: true,
      promptCacheKeyStrategy: "default",
      quietMode: true,
      pidOffsetEnabled: false,
      headerTransformDebug: false,
      compatInputSanitizerEnabled: false,
      internalCollaborationModeHeader: "x-opencode-collaboration-mode-kind",
      requestSnapshots: {
        captureRequest: vi.fn(async () => {}),
        captureResponse: vi.fn(async () => {})
      },
      sessionAffinityState: {
        orchestratorState: createFetchOrchestratorState(),
        stickySessionState: createStickySessionState(),
        hybridSessionState: createStickySessionState(),
        persistSessionAffinityState: vi.fn(async () => {})
      },
      getCatalogModels: () => undefined,
      syncCatalogFromAuth: vi.fn(async () => undefined),
      setCooldown: vi.fn(async () => {}),
      showToast: vi.fn(async () => {}),
      shareableDebug
    })

    const response = await handler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        session_id: "ses_trace_1",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.4",
        input: "hi",
        prompt_cache_key: "pck_trace_1"
      })
    })

    expect(response.status).toBe(200)
    expect(shareableDebug.emitFetchAttemptRequest).toHaveBeenCalledTimes(2)
    expect(shareableDebug.emitFetchAttemptResponse).toHaveBeenCalledTimes(2)
    expect(shareableDebug.emitRetryAfter429).toHaveBeenCalledWith(
      expect.objectContaining({
        authMode: "codex",
        attempt: 2,
        attemptReasonCode: "retry_switched_account_after_429",
        selectedIdentityKey: "acc_2|user2@example.com|pro",
        sessionKey: "ses_trace_1"
      })
    )
  })

  it("emits initial-attempt events without retry and falls back to selection metadata", async () => {
    vi.resetModules()

    const acquireOpenAIAuth = vi.fn(async () => ({
      access: "access_1",
      accountId: "acc_1",
      selectionTrace: {
        selectedIdentityKey: "acc_1|user1@example.com|plus",
        activeIdentityKey: "acc_2|user2@example.com|pro"
      }
    }))
    vi.doMock("../lib/codex-native/acquire-auth", () => ({
      acquireOpenAIAuth
    }))

    const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
    const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
    const { createStickySessionState } = await import("../lib/rotation")

    const shareableDebug = {
      enabled: true,
      emitRotationBegin: vi.fn(async () => {}),
      emitRotationDecision: vi.fn(async () => {}),
      emitRotationCandidateSelected: vi.fn(async () => {}),
      emitFetchAttemptRequest: vi.fn(async () => {}),
      emitFetchAttemptResponse: vi.fn(async () => {}),
      emitRetryAfter429: vi.fn(async () => {}),
      emitAuthFailure: vi.fn(async () => {}),
      emitSyntheticFatalError: vi.fn(async () => {})
    }

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => {
        const response = new Response("ok", { status: 200 })
        Object.defineProperty(response, "url", {
          value: "https://chatgpt.com/backend-api/codex/responses"
        })
        return response
      })
    )

    const handler = createOpenAIFetchHandler({
      authMode: "codex",
      spoofMode: "codex",
      remapDeveloperMessagesToUserEnabled: true,
      promptCacheKeyStrategy: "default",
      quietMode: true,
      pidOffsetEnabled: false,
      configuredRotationStrategy: "round_robin",
      headerTransformDebug: false,
      compatInputSanitizerEnabled: false,
      internalCollaborationModeHeader: "x-opencode-collaboration-mode-kind",
      requestSnapshots: {
        captureRequest: vi.fn(async () => {}),
        captureResponse: vi.fn(async () => {})
      },
      sessionAffinityState: {
        orchestratorState: createFetchOrchestratorState(),
        stickySessionState: createStickySessionState(),
        hybridSessionState: createStickySessionState(),
        persistSessionAffinityState: vi.fn(async () => {})
      },
      getCatalogModels: () => undefined,
      syncCatalogFromAuth: vi.fn(async () => undefined),
      setCooldown: vi.fn(async () => {}),
      showToast: vi.fn(async () => {}),
      shareableDebug
    })

    const response = await handler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        session_id: "ses_trace_2",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.4",
        input: "hi",
        prompt_cache_key: "pck_trace_2"
      })
    })

    expect(response.status).toBe(200)
    expect(shareableDebug.emitFetchAttemptRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        authMode: "codex",
        attempt: 1,
        attemptReasonCode: "initial_attempt",
        rotationStrategy: "round_robin",
        selectedIdentityKey: "acc_1|user1@example.com|plus",
        activeIdentityKey: "acc_2|user2@example.com|pro",
        sessionKey: "ses_trace_2"
      })
    )
    expect(shareableDebug.emitFetchAttemptResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        authMode: "codex",
        attempt: 1,
        attemptReasonCode: "initial_attempt",
        rotationStrategy: "round_robin",
        selectedIdentityKey: "acc_1|user1@example.com|plus",
        activeIdentityKey: "acc_2|user2@example.com|pro",
        sessionKey: "ses_trace_2"
      })
    )
    expect(shareableDebug.emitRetryAfter429).not.toHaveBeenCalled()
  })

  it("emits synthetic fatal events for plugin fatal responses", async () => {
    vi.resetModules()

    const acquireOpenAIAuth = vi.fn(async () => ({
      access: "access_1",
      accountId: "acc_1",
      identityKey: "acc_1|user1@example.com|plus"
    }))
    vi.doMock("../lib/codex-native/acquire-auth", () => ({
      acquireOpenAIAuth
    }))

    const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
    const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
    const { createStickySessionState } = await import("../lib/rotation")

    const shareableDebug = {
      enabled: true,
      emitRotationBegin: vi.fn(async () => {}),
      emitRotationDecision: vi.fn(async () => {}),
      emitRotationCandidateSelected: vi.fn(async () => {}),
      emitFetchAttemptRequest: vi.fn(async () => {}),
      emitFetchAttemptResponse: vi.fn(async () => {}),
      emitRetryAfter429: vi.fn(async () => {}),
      emitAuthFailure: vi.fn(async () => {}),
      emitSyntheticFatalError: vi.fn(async () => {})
    }

    const handler = createOpenAIFetchHandler({
      authMode: "codex",
      spoofMode: "codex",
      remapDeveloperMessagesToUserEnabled: true,
      promptCacheKeyStrategy: "default",
      quietMode: true,
      pidOffsetEnabled: false,
      headerTransformDebug: false,
      compatInputSanitizerEnabled: false,
      internalCollaborationModeHeader: "x-opencode-collaboration-mode-kind",
      requestSnapshots: {
        captureRequest: vi.fn(async () => {}),
        captureResponse: vi.fn(async () => {})
      },
      sessionAffinityState: {
        orchestratorState: createFetchOrchestratorState(),
        stickySessionState: createStickySessionState(),
        hybridSessionState: createStickySessionState(),
        persistSessionAffinityState: vi.fn(async () => {})
      },
      getCatalogModels: () => undefined,
      syncCatalogFromAuth: vi.fn(async () => undefined),
      setCooldown: vi.fn(async () => {}),
      showToast: vi.fn(async () => {}),
      shareableDebug
    })

    const response = await handler("not a valid outbound url")
    expect(response.status).toBe(400)
    expect(shareableDebug.emitSyntheticFatalError).toHaveBeenCalledWith(
      expect.objectContaining({
        authMode: "codex",
        outcome: "disallowed_outbound_request",
        status: 400,
        endpoint: "not a valid outbound url"
      })
    )
    expect(acquireOpenAIAuth).not.toHaveBeenCalled()
  })

  it("emits synthetic fatal events when rewritten outbound validation fails", async () => {
    vi.resetModules()

    const acquireOpenAIAuth = vi.fn(async () => ({
      access: "access_1",
      accountId: "acc_1",
      identityKey: "acc_1|user1@example.com|plus"
    }))
    vi.doMock("../lib/codex-native/acquire-auth", () => ({
      acquireOpenAIAuth
    }))

    let validateCount = 0
    vi.doMock("../lib/codex-native/request-routing", async () => {
      const actual = await vi.importActual<typeof import("../lib/codex-native/request-routing")>(
        "../lib/codex-native/request-routing"
      )
      return {
        ...actual,
        rewriteUrl: vi.fn((request: Request) => request.url),
        assertAllowedOutboundUrl: vi.fn((_url: URL) => {
          validateCount += 1
          if (validateCount === 2) {
            throw new Error("rewritten url invalid")
          }
        })
      }
    })

    const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
    const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
    const { createStickySessionState } = await import("../lib/rotation")

    const shareableDebug = {
      enabled: true,
      emitRotationBegin: vi.fn(async () => {}),
      emitRotationDecision: vi.fn(async () => {}),
      emitRotationCandidateSelected: vi.fn(async () => {}),
      emitFetchAttemptRequest: vi.fn(async () => {}),
      emitFetchAttemptResponse: vi.fn(async () => {}),
      emitRetryAfter429: vi.fn(async () => {}),
      emitAuthFailure: vi.fn(async () => {}),
      emitSyntheticFatalError: vi.fn(async () => {})
    }

    const handler = createOpenAIFetchHandler({
      authMode: "codex",
      spoofMode: "codex",
      remapDeveloperMessagesToUserEnabled: true,
      promptCacheKeyStrategy: "default",
      quietMode: true,
      pidOffsetEnabled: false,
      headerTransformDebug: false,
      compatInputSanitizerEnabled: false,
      internalCollaborationModeHeader: "x-opencode-collaboration-mode-kind",
      requestSnapshots: {
        captureRequest: vi.fn(async () => {}),
        captureResponse: vi.fn(async () => {})
      },
      sessionAffinityState: {
        orchestratorState: createFetchOrchestratorState(),
        stickySessionState: createStickySessionState(),
        hybridSessionState: createStickySessionState(),
        persistSessionAffinityState: vi.fn(async () => {})
      },
      getCatalogModels: () => undefined,
      syncCatalogFromAuth: vi.fn(async () => undefined),
      setCooldown: vi.fn(async () => {}),
      showToast: vi.fn(async () => {}),
      shareableDebug
    })

    const response = await handler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        session_id: "ses_trace_invalid_rewrite",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.4",
        input: "hi"
      })
    })

    expect(response.status).toBe(400)
    expect(shareableDebug.emitSyntheticFatalError).toHaveBeenCalledWith(
      expect.objectContaining({
        authMode: "codex",
        outcome: "disallowed_outbound_request",
        status: 400,
        endpoint: "https://api.openai.com/v1/responses"
      })
    )
  })

  it("emits synthetic fatal events when upstream fetch fails unexpectedly", async () => {
    vi.resetModules()

    const acquireOpenAIAuth = vi.fn(async () => ({
      access: "access_1",
      accountId: "acc_1",
      identityKey: "acc_1|user1@example.com|plus",
      selectionTrace: {
        selectedIdentityKey: "acc_1|user1@example.com|plus",
        activeIdentityKey: "acc_1|user1@example.com|plus"
      }
    }))
    vi.doMock("../lib/codex-native/acquire-auth", () => ({
      acquireOpenAIAuth
    }))

    const { createOpenAIFetchHandler } = await import("../lib/codex-native/openai-loader-fetch")
    const { createFetchOrchestratorState } = await import("../lib/fetch-orchestrator")
    const { createStickySessionState } = await import("../lib/rotation")

    const shareableDebug = {
      enabled: true,
      emitRotationBegin: vi.fn(async () => {}),
      emitRotationDecision: vi.fn(async () => {}),
      emitRotationCandidateSelected: vi.fn(async () => {}),
      emitFetchAttemptRequest: vi.fn(async () => {}),
      emitFetchAttemptResponse: vi.fn(async () => {}),
      emitRetryAfter429: vi.fn(async () => {}),
      emitAuthFailure: vi.fn(async () => {}),
      emitSyntheticFatalError: vi.fn(async () => {})
    }

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket hang up")
      })
    )

    const handler = createOpenAIFetchHandler({
      authMode: "codex",
      spoofMode: "codex",
      remapDeveloperMessagesToUserEnabled: true,
      promptCacheKeyStrategy: "default",
      quietMode: true,
      pidOffsetEnabled: false,
      headerTransformDebug: false,
      compatInputSanitizerEnabled: false,
      internalCollaborationModeHeader: "x-opencode-collaboration-mode-kind",
      requestSnapshots: {
        captureRequest: vi.fn(async () => {}),
        captureResponse: vi.fn(async () => {})
      },
      sessionAffinityState: {
        orchestratorState: createFetchOrchestratorState(),
        stickySessionState: createStickySessionState(),
        hybridSessionState: createStickySessionState(),
        persistSessionAffinityState: vi.fn(async () => {})
      },
      getCatalogModels: () => undefined,
      syncCatalogFromAuth: vi.fn(async () => undefined),
      setCooldown: vi.fn(async () => {}),
      showToast: vi.fn(async () => {}),
      shareableDebug
    })

    const response = await handler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        session_id: "ses_trace_fetch_failure",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.4",
        input: "hi"
      })
    })

    expect(response.status).toBe(502)
    expect(shareableDebug.emitSyntheticFatalError).toHaveBeenCalledWith(
      expect.objectContaining({
        authMode: "codex",
        outcome: "plugin_fetch_failed",
        status: 502,
        endpoint: "https://api.openai.com/v1/responses",
        selectedIdentityKey: "acc_1|user1@example.com|plus",
        activeIdentityKey: "acc_1|user1@example.com|plus"
      })
    )
  })
})
