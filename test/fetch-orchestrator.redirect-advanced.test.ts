import { afterEach, describe, expect, it, vi } from "vitest"
import { FetchOrchestrator, createFetchOrchestratorState } from "../lib/fetch-orchestrator"
import { resetStubbedGlobals, stubGlobalForTest } from "./helpers/mock-policy"

afterEach(() => {
  resetStubbedGlobals()
})

describe("FetchOrchestrator advanced redirect behavior", () => {
  it("classifies 429 retries as switched when attempt keys change without identity tuple", async () => {
    const auths = [
      { access: "access1", accountLabel: "same-label", selectionTrace: { attemptKey: "idx:1" } },
      { access: "access2", accountLabel: "same-label", selectionTrace: { attemptKey: "idx:2" } }
    ]
    let authIdx = 0
    const acquireAuth = vi.fn(async () => auths[authIdx++])
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const attemptReasonCodes: string[] = []

    let fetchCount = 0
    stubGlobalForTest(
      "fetch",
      vi.fn(async () => {
        fetchCount += 1
        if (fetchCount === 1) {
          return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "1" } })
        }
        return new Response("OK", { status: 200 })
      })
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      maxAttempts: 2,
      onAttemptRequest: ({ attemptReasonCode }) => {
        attemptReasonCodes.push(attemptReasonCode)
      }
    })

    const res = await orch.execute("https://api.openai.com/v1/chat/completions")
    expect(res.status).toBe(200)
    expect(attemptReasonCodes).toEqual(["initial_attempt", "retry_switched_account_after_429"])
  })

  it("classifies 429 retries as same-account when retry account key is stable", async () => {
    const auths = [
      { access: "access1", accountLabel: "first-label", selectionTrace: { attemptKey: "idx:1" } },
      { access: "access2", accountLabel: "second-label", selectionTrace: { attemptKey: "idx:1" } }
    ]
    let authIdx = 0
    const acquireAuth = vi.fn(async () => auths[authIdx++])
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<
      (message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>
    >(async () => {})
    const attemptReasonCodes: string[] = []

    let fetchCount = 0
    stubGlobalForTest(
      "fetch",
      vi.fn(async () => {
        fetchCount += 1
        if (fetchCount === 1) {
          return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "1" } })
        }
        return new Response("OK", { status: 200 })
      })
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      maxAttempts: 2,
      onAttemptRequest: ({ attemptReasonCode }) => {
        attemptReasonCodes.push(attemptReasonCode)
      }
    })

    const res = await orch.execute("https://api.openai.com/v1/chat/completions")
    expect(res.status).toBe(200)
    expect(attemptReasonCodes).toEqual(["initial_attempt", "retry_same_account_after_429"])
    expect(showToast.mock.calls.some((call) => String(call[0]).includes("after rate limit"))).toBe(false)
  })

  it("prunes toast dedupe maps to bounded sizes", async () => {
    const state = createFetchOrchestratorState()
    for (let index = 0; index < 600; index += 1) {
      state.toastShownAt.set(`toast-${index}`, 0)
      state.rateLimitToastShownAt.set(`rate-${index}`, 0)
    }

    const acquireAuth = vi.fn(async () => ({ access: "a", identityKey: "id-rate", accountLabel: "acct" }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<
      (message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>
    >(async () => {})

    let fetchCount = 0
    stubGlobalForTest(
      "fetch",
      vi.fn(async () => {
        fetchCount += 1
        if (fetchCount === 1) {
          return new Response("Too Many Requests", { status: 429 })
        }
        return new Response("OK", { status: 200 })
      })
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      state,
      maxAttempts: 2,
      now: () => 7 * 60 * 60 * 1000,
      showToast
    })

    await orch.execute("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses-prune-toast" },
      body: JSON.stringify({ input: "x" })
    })
    expect(state.toastShownAt.size).toBeLessThanOrEqual(512)
    expect(state.rateLimitToastShownAt.size).toBeLessThanOrEqual(512)
  })

  it("strips sensitive headers when redirect crosses origin", async () => {
    const acquireAuth = vi.fn(async () => ({ access: "a", identityKey: "id1", accountId: "acc1" }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})

    const seenRequests: Request[] = []
    stubGlobalForTest(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        seenRequests.push(request)
        if (seenRequests.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: "https://chatgpt.com/backend-api/codex/responses" }
          })
        }
        return new Response("ok", { status: 200 })
      })
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      maxAttempts: 1,
      validateRedirectUrl: () => {}
    })

    const response = await orch.execute("https://api.openai.com/v1/chat/completions", {
      method: "GET",
      headers: {
        Authorization: "Bearer a",
        "ChatGPT-Account-Id": "acc1",
        session_id: "ses_123"
      }
    })

    expect(response.status).toBe(200)
    expect(seenRequests).toHaveLength(2)
    const redirected = seenRequests[1]
    expect(redirected?.url).toBe("https://chatgpt.com/backend-api/codex/responses")
    expect(redirected?.headers.get("authorization")).toBeNull()
    expect(redirected?.headers.get("chatgpt-account-id")).toBeNull()
    expect(redirected?.headers.get("session_id")).toBeNull()
  })

  it("preserves auth headers when redirect remains on same origin", async () => {
    const acquireAuth = vi.fn(async () => ({ access: "a", identityKey: "id1", accountId: "acc1" }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})

    const seenRequests: Request[] = []
    stubGlobalForTest(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        seenRequests.push(request)
        if (seenRequests.length === 1) {
          return new Response(null, {
            status: 302,
            headers: { location: "https://api.openai.com/v1/responses" }
          })
        }
        return new Response("ok", { status: 200 })
      })
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      maxAttempts: 1,
      validateRedirectUrl: () => {}
    })

    const response = await orch.execute("https://api.openai.com/v1/chat/completions", {
      method: "GET",
      headers: {
        Authorization: "Bearer a",
        "ChatGPT-Account-Id": "acc1",
        session_id: "ses_123"
      }
    })

    expect(response.status).toBe(200)
    expect(seenRequests).toHaveLength(2)
    const redirected = seenRequests[1]
    expect(redirected?.headers.get("authorization")).toBe("Bearer a")
    expect(redirected?.headers.get("chatgpt-account-id")).toBe("acc1")
    expect(redirected?.headers.get("session_id")).toBe("ses_123")
  })
})
