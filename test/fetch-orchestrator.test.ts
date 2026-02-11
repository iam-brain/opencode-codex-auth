import { describe, expect, it, vi } from "vitest"
import { FetchOrchestrator, createFetchOrchestratorState } from "../lib/fetch-orchestrator"

describe("FetchOrchestrator", () => {
  it("retries with different account after 429", async () => {
    const auths = [
      { access: "access1", identityKey: "id1", accountId: "acc1" },
      { access: "access2", identityKey: "id2", accountId: "acc2" },
    ]
    let authIdx = 0
    const acquireAuth = vi.fn(async () => auths[authIdx++])
    const setCooldown = vi.fn(async () => {})

    let fetchCount = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCount++
      const req = new Request(input, init)
      const auth = req.headers.get("authorization")
      
      if (fetchCount === 1) {
        expect(auth).toBe("Bearer access1")
        expect(req.headers.get("ChatGPT-Account-Id")).toBe("acc1")
        return new Response("Too Many Requests", {
          status: 429,
          headers: { "Retry-After": "10" }
        })
      }
      
      expect(auth).toBe("Bearer access2")
      expect(req.headers.get("ChatGPT-Account-Id")).toBe("acc2")
      return new Response("OK", { status: 200 })
    }))

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      now: () => 1000,
      maxAttempts: 2
    })

    const res = await orch.execute("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ test: true })
    })

    expect(res.status).toBe(200)
    expect(fetchCount).toBe(2)
    expect(acquireAuth).toHaveBeenCalledTimes(2)
    expect(setCooldown).toHaveBeenCalledWith("id1", 11000) // 1000 + 10 * 1000
  })

  it("applies fallback cooldown when 429 has no retry-after header", async () => {
    const auths = [
      { access: "access1", identityKey: "id1", accountId: "acc1" },
      { access: "access2", identityKey: "id2", accountId: "acc2" }
    ]
    let authIdx = 0
    const acquireAuth = vi.fn(async () => auths[authIdx++])
    const setCooldown = vi.fn(async () => {})

    let fetchCount = 0
    vi.stubGlobal("fetch", vi.fn(async () => {
      fetchCount++
      if (fetchCount === 1) {
        return new Response("Too Many Requests", { status: 429 })
      }
      return new Response("OK", { status: 200 })
    }))

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      now: () => 1000,
      maxAttempts: 2
    })

    const res = await orch.execute("https://api.openai.com/v1/chat/completions")
    expect(res.status).toBe(200)
    expect(fetchCount).toBe(2)
    expect(setCooldown).toHaveBeenCalledWith("id1", 6000)
  })

  it("stops after maxAttempts", async () => {
    const acquireAuth = vi.fn(async () => ({ access: "a", identityKey: "i" }))
    const setCooldown = vi.fn(async () => {})

    vi.stubGlobal("fetch", vi.fn(async () => {
      return new Response("RL", { status: 429, headers: { "Retry-After": "1" } })
    }))

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      now: () => 1000,
      maxAttempts: 3
    })

    const res = await orch.execute("https://api.openai.com/v1/chat/completions")
    expect(res.status).toBe(429)
    expect(acquireAuth).toHaveBeenCalledTimes(3)
    const body = await res.json()
    expect(body.error?.type).toBe("all_accounts_rate_limited")
  })

  it("clamps maxAttempts to at least one attempt", async () => {
    const acquireAuth = vi.fn(async () => ({ access: "a", identityKey: "i" }))
    const setCooldown = vi.fn(async () => {})
    const fetchMock = vi.fn(async () => new Response("RL", { status: 429 }))
    vi.stubGlobal("fetch", fetchMock)

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      maxAttempts: 0
    })

    const res = await orch.execute("https://api.openai.com/v1/chat/completions")
    expect(res.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(acquireAuth).toHaveBeenCalledTimes(1)
  })

  it("falls back to default attempts when maxAttempts is NaN", async () => {
    const acquireAuth = vi.fn(async () => ({ access: "a", identityKey: "i" }))
    const setCooldown = vi.fn(async () => {})
    const fetchMock = vi.fn(async () => new Response("RL", { status: 429 }))
    vi.stubGlobal("fetch", fetchMock)

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      maxAttempts: Number.NaN
    })

    const res = await orch.execute("https://api.openai.com/v1/chat/completions")
    expect(res.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(acquireAuth).toHaveBeenCalledTimes(3)
  })

  it("falls back to default attempts when maxAttempts is infinite", async () => {
    const acquireAuth = vi.fn(async () => ({ access: "a", identityKey: "i" }))
    const setCooldown = vi.fn(async () => {})
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length > 10) {
        throw new Error("unexpected unbounded retry")
      }
      return new Response("RL", { status: 429 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      maxAttempts: Number.POSITIVE_INFINITY
    })

    const res = await orch.execute("https://api.openai.com/v1/chat/completions")
    expect(res.status).toBe(429)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(acquireAuth).toHaveBeenCalledTimes(3)
  })

  it("retries successfully when body is a ReadableStream", async () => {
    const acquireAuth = vi.fn(async () => ({ access: "a", identityKey: "i" }))
    const setCooldown = vi.fn(async () => {})

    let fetchCount = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCount++
      const req = new Request(input, init)
      // Consume the body to ensure it's "used"
      await req.text()
      
      if (fetchCount === 1) {
        return new Response("RL", { status: 429 })
      }
      return new Response("OK", { status: 200 })
    }))

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      maxAttempts: 2
    })

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("test stream"))
        controller.close()
      }
    })

    const res = await orch.execute("https://api.com", {
      method: "POST",
      body: stream,
      // @ts-ignore - duplex is required for stream body in some environments
      duplex: "half"
    })

    expect(res.status).toBe(200)
    expect(fetchCount).toBe(2)
  })

  it("uses a consistent 'now' timestamp for Retry-After calculations", async () => {
    const acquireAuth = vi.fn(async () => ({ access: "a", identityKey: "id1" }))
    const setCooldown = vi.fn(async () => {})

    vi.stubGlobal("fetch", vi.fn(async () => {
      return new Response("RL", {
        status: 429,
        headers: { "Retry-After": "Wed, 21 Oct 2015 07:28:00 GMT" }
      })
    }))

    let nowCalls = 0
    const nowStubs = [1000, 2000, 3000]
    const now = vi.fn(() => nowStubs[nowCalls++])

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      now,
      maxAttempts: 1
    })

    await orch.execute("https://api.com")

    const expectedDateMs = new Date("Wed, 21 Oct 2015 07:28:00 GMT").getTime()
    // Current implementation:
    // retryAfterMs = parseRetryAfterMs(..., now()) // now() -> 1000. returns dateMs - 1000
    // cooldownUntil = now() + retryAfterMs // now() -> 2000. returns 2000 + dateMs - 1000 = dateMs + 1000
    // So it should FAIL if we expect exactly expectedDateMs
    expect(setCooldown).toHaveBeenCalledWith("id1", expectedDateMs)
  })

  it("shows a toast when a new chat starts", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "a",
      identityKey: "id1",
      accountId: "acc1",
      accountLabel: "user@example.com (plus)"
    }))
    const setCooldown = vi.fn(async () => {})
    const showToast = vi.fn(async () => {})

    vi.stubGlobal("fetch", vi.fn(async () => new Response("OK", { status: 200 })))

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast
    })

    await orch.execute("https://api.com", {
      method: "POST",
      body: JSON.stringify({ prompt_cache_key: "ses_new_1", input: "hi" })
    })

    expect(showToast).toHaveBeenCalledWith("New chat: user@example.com (plus)", "info", false)
  })

  it("shows a toast when switching to an existing session", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "a",
      identityKey: "id1",
      accountId: "acc1",
      accountLabel: "user@example.com (plus)"
    }))
    const setCooldown = vi.fn(async () => {})
    const showToast = vi.fn(async () => {})

    vi.stubGlobal("fetch", vi.fn(async () => new Response("OK", { status: 200 })))

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast
    })

    await orch.execute("https://api.com", {
      method: "POST",
      body: JSON.stringify({ prompt_cache_key: "ses_alpha", input: "one" })
    })
    await orch.execute("https://api.com", {
      method: "POST",
      body: JSON.stringify({ prompt_cache_key: "ses_beta", input: "two" })
    })
    await orch.execute("https://api.com", {
      method: "POST",
      body: JSON.stringify({ prompt_cache_key: "ses_alpha", input: "three" })
    })

    expect(
      showToast.mock.calls.some(
        (call) =>
          call[0] === "Session switched: user@example.com (plus)" &&
          call[1] === "info" &&
          call[2] === false
      )
    ).toBe(true)
  })

  it("shows a resume toast for previously-seen sessions after restart", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "a",
      identityKey: "id1",
      accountId: "acc1",
      accountLabel: "user@example.com (plus)"
    }))
    const setCooldown = vi.fn(async () => {})
    const showToast = vi.fn(async () => {})
    const sharedState = createFetchOrchestratorState()
    sharedState.seenSessionKeys.set("ses_resume_1", Date.now())

    vi.stubGlobal("fetch", vi.fn(async () => new Response("OK", { status: 200 })))

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      state: sharedState
    })

    await orch.execute("https://api.com", {
      method: "POST",
      body: JSON.stringify({ prompt_cache_key: "ses_resume_1", input: "continue" })
    })

    expect(showToast).toHaveBeenCalledWith("Resuming chat: user@example.com (plus)", "info", false)
    expect(
      showToast.mock.calls.some((call) => call[0] === "New chat: user@example.com (plus)")
    ).toBe(false)
  })

  it("shows a toast when the account changes", async () => {
    const auths = [
      { access: "a1", identityKey: "id1", accountId: "acc1", accountLabel: "one@example.com (plus)" },
      { access: "a2", identityKey: "id2", accountId: "acc2", accountLabel: "two@example.com (pro)" }
    ]
    let idx = 0
    const acquireAuth = vi.fn(async () => auths[idx++])
    const setCooldown = vi.fn(async () => {})
    const showToast = vi.fn(async () => {})

    vi.stubGlobal("fetch", vi.fn(async () => new Response("OK", { status: 200 })))

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast
    })

    await orch.execute("https://api.com")
    await orch.execute("https://api.com")

    expect(showToast).toHaveBeenCalledWith(
      "Account switched: two@example.com (pro)",
      "info",
      false
    )
  })

  it("shows a warning toast on rate-limit switch", async () => {
    const auths = [
      { access: "a1", identityKey: "id1", accountId: "acc1", accountLabel: "one@example.com (plus)" },
      { access: "a2", identityKey: "id2", accountId: "acc2", accountLabel: "two@example.com (plus)" }
    ]
    let idx = 0
    const acquireAuth = vi.fn(async () => auths[idx++])
    const setCooldown = vi.fn(async () => {})
    const showToast = vi.fn(async () => {})

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (idx === 1) {
          return new Response("Too Many Requests", {
            status: 429,
            headers: { "Retry-After": "1" }
          })
        }
        return new Response("OK", { status: 200 })
      })
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      maxAttempts: 2
    })

    const response = await orch.execute("https://api.com")
    expect(response.status).toBe(200)
    expect(showToast).toHaveBeenCalledWith("Rate limited - switching account", "warning", false)
  })

  it("reuses shared session state across orchestrator instances to avoid duplicate new-chat toasts", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "a",
      identityKey: "id1",
      accountId: "acc1",
      accountLabel: "user@example.com (plus)"
    }))
    const setCooldown = vi.fn(async () => {})
    const showToast = vi.fn(async () => {})
    const sharedState = createFetchOrchestratorState()

    vi.stubGlobal("fetch", vi.fn(async () => new Response("OK", { status: 200 })))

    const first = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      state: sharedState
    })
    await first.execute("https://api.com", {
      method: "POST",
      body: JSON.stringify({ prompt_cache_key: "ses_shared_1", input: "first" })
    })

    const second = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      state: sharedState
    })
    await second.execute("https://api.com", {
      method: "POST",
      body: JSON.stringify({ prompt_cache_key: "ses_shared_1", input: "second" })
    })

    const newChatToasts = showToast.mock.calls.filter(
      (call) => call[0] === "New chat: user@example.com (plus)"
    )
    expect(newChatToasts).toHaveLength(1)
  })

  it("coalesces rapid new-chat toasts across different sessions", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "a",
      identityKey: "id1",
      accountId: "acc1",
      accountLabel: "user@example.com (plus)"
    }))
    const setCooldown = vi.fn(async () => {})
    const showToast = vi.fn(async () => {})
    let nowValue = 1_000

    vi.stubGlobal("fetch", vi.fn(async () => new Response("OK", { status: 200 })))

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      now: () => nowValue
    })

    await orch.execute("https://api.com", {
      method: "POST",
      body: JSON.stringify({ prompt_cache_key: "ses_new_1", input: "one" })
    })
    nowValue = 2_000
    await orch.execute("https://api.com", {
      method: "POST",
      body: JSON.stringify({ prompt_cache_key: "ses_new_2", input: "two" })
    })

    const newChatToasts = showToast.mock.calls.filter(
      (call) => call[0] === "New chat: user@example.com (plus)"
    )
    expect(newChatToasts).toHaveLength(1)
  })

  it("coalesces rapid account-switch toasts", async () => {
    const auths = [
      { access: "a1", identityKey: "id1", accountId: "acc1", accountLabel: "one@example.com (plus)" },
      { access: "a2", identityKey: "id2", accountId: "acc2", accountLabel: "two@example.com (plus)" },
      { access: "a1", identityKey: "id1", accountId: "acc1", accountLabel: "one@example.com (plus)" },
      { access: "a2", identityKey: "id2", accountId: "acc2", accountLabel: "two@example.com (plus)" }
    ]
    let idx = 0
    const acquireAuth = vi.fn(async () => auths[idx++])
    const setCooldown = vi.fn(async () => {})
    const showToast = vi.fn(async () => {})
    let nowValue = 1_000

    vi.stubGlobal("fetch", vi.fn(async () => new Response("OK", { status: 200 })))

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      now: () => nowValue
    })

    await orch.execute("https://api.com")
    nowValue = 2_000
    await orch.execute("https://api.com")
    nowValue = 3_000
    await orch.execute("https://api.com")
    nowValue = 4_000
    await orch.execute("https://api.com")

    const accountSwitchToasts = showToast.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].startsWith("Account switched:")
    )
    expect(accountSwitchToasts).toHaveLength(1)
  })

  it("emits per-attempt request and response snapshots with auth headers", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "token_123",
      identityKey: "id1",
      accountId: "acc1",
      accountLabel: "user@example.com (plus)"
    }))
    const setCooldown = vi.fn(async () => {})
    const onAttemptRequest = vi.fn(async () => {})
    const onAttemptResponse = vi.fn(async () => {})

    vi.stubGlobal("fetch", vi.fn(async () => new Response("OK", { status: 200 })))

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      onAttemptRequest,
      onAttemptResponse
    })

    await orch.execute("https://api.com", {
      method: "POST",
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

  it("falls back to session_id header when prompt_cache_key is missing", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "token_123",
      identityKey: "id1",
      accountId: "acc1"
    }))
    const setCooldown = vi.fn(async () => {})
    const onSessionObserved = vi.fn(async () => {})

    vi.stubGlobal("fetch", vi.fn(async () => new Response("OK", { status: 200 })))

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      onSessionObserved
    })

    await orch.execute("https://api.com", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "ses_from_header"
      },
      body: JSON.stringify({ input: "hello without prompt cache key" })
    })

    expect(onSessionObserved).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "ses_from_header",
        event: "new"
      })
    )
  })
})
