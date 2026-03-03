import { afterEach, describe, expect, it, vi } from "vitest"
import { FetchOrchestrator } from "../lib/fetch-orchestrator"
import { resetStubbedGlobals, stubGlobalForTest } from "./helpers/mock-policy"

afterEach(() => {
  resetStubbedGlobals()
})

describe("FetchOrchestrator snapshots and redirect policy", () => {
  it("emits per-attempt request and response snapshots with auth headers", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "token_123",
      identityKey: "id1",
      accountId: "acc1",
      accountLabel: "user@example.com (plus)"
    }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const onAttemptRequest = vi.fn<
      (input: { request: Request; attempt: number; maxAttempts: number; sessionKey: string | null }) => Promise<void>
    >(async () => {})
    const onAttemptResponse = vi.fn<
      (input: { response: Response; attempt: number; maxAttempts: number; sessionKey: string | null }) => Promise<void>
    >(async () => {})

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      onAttemptRequest,
      onAttemptResponse
    })

    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_snap_1" },
      body: JSON.stringify({ prompt_cache_key: "ses_snap_1", input: "hi" })
    })

    expect(onAttemptRequest).toHaveBeenCalledTimes(1)
    expect(onAttemptResponse).toHaveBeenCalledTimes(1)

    const requestArg = onAttemptRequest.mock.calls[0][0] as {
      request: Request
      attempt: number
      maxAttempts: number
      sessionKey: string | null
    }
    expect(requestArg.attempt).toBe(0)
    expect(requestArg.maxAttempts).toBe(3)
    expect(requestArg.sessionKey).toBe("ses_snap_1")
    expect(requestArg.request.headers.get("Authorization")).toBe("Bearer token_123")
    expect(requestArg.request.headers.get("ChatGPT-Account-Id")).toBe("acc1")
  })

  it("sends onAttemptRequest replacement request when provided", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "token_abc",
      identityKey: "id1",
      accountId: "acc1"
    }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const onAttemptRequest = vi.fn(async ({ request }: { request: Request }) => {
      const payload = JSON.parse(await request.clone().text()) as Record<string, unknown>
      payload.instructions = "Overridden instructions"
      return new Request(request, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(payload)
      })
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const payload = JSON.parse(await request.text()) as Record<string, unknown>
      expect(payload.instructions).toBe("Overridden instructions")
      expect(request.headers.get("Authorization")).toBe("Bearer token_abc")
      expect(request.headers.get("ChatGPT-Account-Id")).toBe("acc1")
      return new Response("OK", { status: 200 })
    })
    stubGlobalForTest("fetch", fetchMock)

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      onAttemptRequest
    })

    const response = await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_replace_1" },
      body: JSON.stringify({ instructions: "Host instructions", input: "hello" })
    })

    expect(response.status).toBe(200)
    expect(onAttemptRequest).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("provides standardized failover reason codes to attempt hooks", async () => {
    const auths = [
      { access: "a1", identityKey: "id1", accountId: "acc1" },
      { access: "a2", identityKey: "id2", accountId: "acc2" }
    ]
    let authIdx = 0
    const acquireAuth = vi.fn(async () => auths[authIdx++])
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})

    const requestReasons: string[] = []
    const responseReasons: string[] = []
    const onAttemptRequest = vi.fn(async ({ attemptReasonCode }) => {
      requestReasons.push(attemptReasonCode)
    })
    const onAttemptResponse = vi.fn(async ({ attemptReasonCode }) => {
      responseReasons.push(attemptReasonCode)
    })

    let fetchCount = 0
    stubGlobalForTest(
      "fetch",
      vi.fn(async () => {
        fetchCount += 1
        if (fetchCount === 1) {
          return new Response("RL", { status: 429, headers: { "Retry-After": "1" } })
        }
        return new Response("OK", { status: 200 })
      })
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      maxAttempts: 2,
      onAttemptRequest,
      onAttemptResponse
    })

    const response = await orch.execute("https://api.com")
    expect(response.status).toBe(200)
    expect(requestReasons).toEqual(["initial_attempt", "retry_switched_account_after_429"])
    expect(responseReasons).toEqual(["initial_attempt", "retry_switched_account_after_429"])
  })

  it("reports retry_same_account_after_429 when retry account identity does not change", async () => {
    const auths = [
      { access: "a1", accountLabel: "first", selectionTrace: { attemptKey: "slot-1" } },
      { access: "a2", accountLabel: "second", selectionTrace: { attemptKey: "slot-1" } }
    ]
    let authIdx = 0
    const acquireAuth = vi.fn(async () => auths[authIdx++])
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})

    const requestReasons: string[] = []
    const responseReasons: string[] = []
    const onAttemptRequest = vi.fn(async ({ attemptReasonCode }) => {
      requestReasons.push(attemptReasonCode)
    })
    const onAttemptResponse = vi.fn(async ({ attemptReasonCode }) => {
      responseReasons.push(attemptReasonCode)
    })

    let fetchCount = 0
    stubGlobalForTest(
      "fetch",
      vi.fn(async () => {
        fetchCount += 1
        if (fetchCount === 1) {
          return new Response("RL", { status: 429, headers: { "Retry-After": "1" } })
        }
        return new Response("OK", { status: 200 })
      })
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      maxAttempts: 2,
      onAttemptRequest,
      onAttemptResponse
    })

    const response = await orch.execute("https://api.com")
    expect(response.status).toBe(200)
    expect(requestReasons).toEqual(["initial_attempt", "retry_same_account_after_429"])
    expect(responseReasons).toEqual(["initial_attempt", "retry_same_account_after_429"])
  })

  it("does not emit session observation when session_id is missing", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "token_123",
      identityKey: "id1",
      accountId: "acc1"
    }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const onSessionObserved = vi.fn<
      (input: { sessionKey: string; now: number; event: "new" | "resume" | "switch" | "seen" }) => Promise<void>
    >(async () => {})

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      onSessionObserved
    })

    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hello without session id" })
    })

    expect(onSessionObserved).not.toHaveBeenCalled()
  })

  it("uses session_id as canonical session key", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "token_123",
      identityKey: "id1",
      accountId: "acc1"
    }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const onSessionObserved = vi.fn<
      (input: { sessionKey: string; now: number; event: "new" | "resume" | "switch" | "seen" }) => Promise<void>
    >(async () => {})

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      onSessionObserved
    })

    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_header" },
      body: JSON.stringify({
        input: "hello with mixed keys",
        prompt_cache_key: "ses_prompt_cache"
      })
    })

    expect(onSessionObserved).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "ses_header",
        event: "new"
      })
    )
  })

  it("blocks redirects when no redirect URL validator is configured", async () => {
    const acquireAuth = vi.fn(async () => ({ access: "a", identityKey: "i" }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => {
        return new Response(null, {
          status: 302,
          headers: { location: "https://example.com/redirect" }
        })
      })
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      maxAttempts: 1
    })

    const response = await orch.execute("https://api.openai.com/v1/chat/completions")
    expect(response.status).toBe(502)
    const body = (await response.json()) as { error?: { type?: string } }
    expect(body.error?.type).toBe("blocked_outbound_redirect")
  })

  it("validates and follows redirects for safe methods", async () => {
    const acquireAuth = vi.fn(async () => ({ access: "a", identityKey: "i" }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const validateRedirectUrl = vi.fn(() => {})

    let calls = 0
    stubGlobalForTest(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls += 1
        const request = new Request(input, init)
        if (calls === 1) {
          expect(request.redirect).toBe("manual")
          return new Response(null, {
            status: 302,
            headers: { location: "https://chatgpt.com/backend-api/codex/responses" }
          })
        }
        return new Response("OK", { status: 200 })
      })
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      maxAttempts: 1,
      validateRedirectUrl
    })

    const response = await orch.execute("https://api.openai.com/v1/chat/completions", { method: "GET" })
    expect(response.status).toBe(200)
    expect(validateRedirectUrl).toHaveBeenCalledWith(new URL("https://chatgpt.com/backend-api/codex/responses"))
  })

  it("blocks redirects for non-idempotent methods", async () => {
    const acquireAuth = vi.fn(async () => ({ access: "a", identityKey: "i" }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => {
        return new Response(null, {
          status: 307,
          headers: { location: "https://chatgpt.com/backend-api/codex/responses" }
        })
      })
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      maxAttempts: 1,
      validateRedirectUrl: () => {}
    })

    const response = await orch.execute("https://api.openai.com/v1/chat/completions", { method: "POST" })
    expect(response.status).toBe(502)
    const body = (await response.json()) as { error?: { type?: string } }
    expect(body.error?.type).toBe("blocked_outbound_redirect")
  })

  it("returns redirect limit error when hop cap exceeded", async () => {
    const acquireAuth = vi.fn(async () => ({ access: "a", identityKey: "i" }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})

    stubGlobalForTest(
      "fetch",
      vi.fn(async () => {
        return new Response(null, {
          status: 302,
          headers: { location: "https://chatgpt.com/backend-api/codex/responses" }
        })
      })
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      maxAttempts: 1,
      validateRedirectUrl: () => {},
      maxRedirects: 0
    })

    const response = await orch.execute("https://api.openai.com/v1/chat/completions", { method: "GET" })
    expect(response.status).toBe(502)
    const body = (await response.json()) as { error?: { type?: string } }
    expect(body.error?.type).toBe("outbound_redirect_limit_exceeded")
  })
})
