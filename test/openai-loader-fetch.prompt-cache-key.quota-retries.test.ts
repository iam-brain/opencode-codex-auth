import { afterEach, describe, expect, it, vi } from "vitest"
import { resetStubbedGlobals, stubGlobalForTest } from "./helpers/mock-policy"

afterEach(() => {
  resetStubbedGlobals()
})

describe("openai loader fetch prompt cache key (quota retries)", () => {
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
    try {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes("/wham/usage")) {
          usageCalls += 1
          throw new Error("quota backend down")
        }
        return new Response("ok", { status: 200 })
      })
      stubGlobalForTest("fetch", fetchMock)

      const setCooldown = vi.fn(async () => {})
      const showToast = vi.fn<
        (message: string, variant?: "info" | "success" | "warning" | "error", quietMode?: boolean) => Promise<void>
      >(async () => {})
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

      await vi.waitFor(() => {
        expect(usageCalls).toBe(1)
      })

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
    } finally {
      nowSpy.mockRestore()
    }
  })

  it("retries quota snapshot fetch after short cooldown when usage payload has no snapshot data", async () => {
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
    try {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes("/wham/usage")) {
          usageCalls += 1
          return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
        }
        return new Response("ok", { status: 200 })
      })
      stubGlobalForTest("fetch", fetchMock)

      const setCooldown = vi.fn(async () => {})
      const showToast = vi.fn<
        (message: string, variant?: "info" | "success" | "warning" | "error", quietMode?: boolean) => Promise<void>
      >(async () => {})
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
        showToast
      })

      await handler("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          session_id: "ses_quota_empty_1"
        },
        body: JSON.stringify({ model: "gpt-5.3-codex", input: "hello" })
      })

      await vi.waitFor(() => {
        expect(usageCalls).toBe(1)
      })
      await Promise.resolve()
      await Promise.resolve()

      now += 5_000

      await handler("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          session_id: "ses_quota_empty_2"
        },
        body: JSON.stringify({ model: "gpt-5.3-codex", input: "hello again" })
      })

      expect(usageCalls).toBe(1)

      now += 5_500

      await handler("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          session_id: "ses_quota_empty_3"
        },
        body: JSON.stringify({ model: "gpt-5.3-codex", input: "hello after retry window" })
      })

      await vi.waitFor(() => {
        expect(usageCalls).toBe(2)
      })
      expect(setCooldown).not.toHaveBeenCalled()
      expect(showToast.mock.calls.some((call) => String(call[0]).includes("Switching account due to"))).toBe(false)
    } finally {
      nowSpy.mockRestore()
    }
  })
})
