import { afterEach, describe, expect, it, vi } from "vitest"
import { FetchOrchestrator, createFetchOrchestratorState } from "../lib/fetch-orchestrator"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("FetchOrchestrator", () => {
  it("retries with different account after 429", async () => {
    const auths = [
      { access: "access1", identityKey: "id1", accountId: "acc1" },
      { access: "access2", identityKey: "id2", accountId: "acc2" }
    ]
    let authIdx = 0
    const acquireAuth = vi.fn(async () => {
      const next = auths[authIdx++]
      if (!next) throw new Error("missing auth")
      return next
    })
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})

    let fetchCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
      })
    )

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
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})

    let fetchCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCount++
        if (fetchCount === 1) {
          return new Response("Too Many Requests", { status: 429 })
        }
        return new Response("OK", { status: 200 })
      })
    )

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

  it("continues retry flow when setCooldown throws", async () => {
    const auths = [
      { access: "access1", identityKey: "id1", accountId: "acc1" },
      { access: "access2", identityKey: "id2", accountId: "acc2" }
    ]
    let authIdx = 0
    const acquireAuth = vi.fn(async () => auths[authIdx++]!)
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {
      throw new Error("disk write failed")
    })

    let fetchCount = 0
    vi.stubGlobal(
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
      now: () => 1_000,
      maxAttempts: 2
    })

    const res = await orch.execute("https://api.openai.com/v1/chat/completions")
    expect(res.status).toBe(200)
    expect(acquireAuth).toHaveBeenCalledTimes(2)
    expect(setCooldown).toHaveBeenCalledTimes(1)
  })

  it("stops after maxAttempts", async () => {
    const acquireAuth = vi.fn(async () => ({ access: "a", identityKey: "i" }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response("RL", { status: 429, headers: { "Retry-After": "1" } })
      })
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      now: () => 1000,
      maxAttempts: 3
    })

    const res = await orch.execute("https://api.openai.com/v1/chat/completions")
    expect(res.status).toBe(429)
    expect(acquireAuth).toHaveBeenCalledTimes(3)
    const body = (await res.json()) as { error?: { type?: string } }
    expect(body.error?.type).toBe("all_accounts_rate_limited")
  })

  it("clamps maxAttempts to at least one attempt", async () => {
    const acquireAuth = vi.fn(async () => ({ access: "a", identityKey: "i" }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
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
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
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
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
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
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})

    let fetchCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCount++
        const req = new Request(input, init)
        // Consume the body to ensure it's "used"
        await req.text()

        if (fetchCount === 1) {
          return new Response("RL", { status: 429 })
        }
        return new Response("OK", { status: 200 })
      })
    )

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
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response("RL", {
          status: 429,
          headers: { "Retry-After": "Wed, 21 Oct 2015 07:28:00 GMT" }
        })
      })
    )

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
    expect(setCooldown).toHaveBeenCalledTimes(1)
    const args = setCooldown.mock.calls[0]
    expect(args?.[0]).toBe("id1")
    const cooldownUntil = args?.[1]
    expect(typeof cooldownUntil).toBe("number")
    expect(cooldownUntil as number).toBeGreaterThanOrEqual(expectedDateMs - 1_000)
    expect(cooldownUntil as number).toBeLessThanOrEqual(expectedDateMs + 3_000)
  })

  it("shows a toast when a new chat starts", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "a",
      identityKey: "id1",
      accountId: "acc1",
      accountLabel: "user@example.com (plus)"
    }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<(message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>>(async () => {})

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast
    })

    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_new_1" },
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
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<(message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>>(async () => {})

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast
    })

    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_alpha" },
      body: JSON.stringify({ prompt_cache_key: "ses_alpha", input: "one" })
    })
    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_beta" },
      body: JSON.stringify({ prompt_cache_key: "ses_beta", input: "two" })
    })
    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_alpha" },
      body: JSON.stringify({ prompt_cache_key: "ses_alpha", input: "three" })
    })

    expect(
      showToast.mock.calls.some(
        (call) => call[0] === "Session switched: user@example.com (plus)" && call[1] === "info" && call[2] === false
      )
    ).toBe(true)
  })

  it("shows a resume toast when restoring the same active session context", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "a",
      identityKey: "id1",
      accountId: "acc1",
      accountLabel: "user@example.com (plus)"
    }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<(message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>>(async () => {})
    const sharedState = createFetchOrchestratorState()
    sharedState.seenSessionKeys.set("ses_resume_1", Date.now())
    sharedState.lastSessionKey = "ses_resume_1"

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      state: sharedState
    })

    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_resume_1" },
      body: JSON.stringify({ prompt_cache_key: "ses_resume_1", input: "continue" })
    })

    expect(showToast).toHaveBeenCalledWith("Resuming chat: user@example.com (plus)", "info", false)
    expect(showToast.mock.calls.some((call) => call[0] === "New chat: user@example.com (plus)")).toBe(false)
  })

  it("does not emit a resume toast for seen sessions when no last active session is restored", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "a",
      identityKey: "id1",
      accountId: "acc1",
      accountLabel: "user@example.com (plus)"
    }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<(message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>>(async () => {})
    const sharedState = createFetchOrchestratorState()
    sharedState.seenSessionKeys.set("ses_seen_1", Date.now())
    sharedState.lastSessionKey = null

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      state: sharedState
    })

    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_seen_1" },
      body: JSON.stringify({ prompt_cache_key: "ses_seen_1", input: "continue" })
    })

    expect(showToast.mock.calls.some((call) => call[0] === "Resuming chat: user@example.com (plus)")).toBe(false)
    expect(showToast.mock.calls.some((call) => call[0] === "New chat: user@example.com (plus)")).toBe(false)
  })

  it("shows a toast when the account changes", async () => {
    const auths = [
      { access: "a1", identityKey: "id1", accountId: "acc1", accountLabel: "one@example.com (plus)" },
      { access: "a2", identityKey: "id2", accountId: "acc2", accountLabel: "two@example.com (pro)" }
    ]
    let idx = 0
    const acquireAuth = vi.fn(async () => auths[idx++])
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<(message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>>(async () => {})

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast
    })

    await orch.execute("https://api.com")
    await orch.execute("https://api.com")

    expect(showToast).toHaveBeenCalledWith("Account switched: two@example.com (pro)", "info", false)
  })

  it("shows a warning toast on rate-limit switch", async () => {
    const auths = [
      { access: "a1", identityKey: "id1", accountId: "acc1", accountLabel: "one@example.com (plus)" },
      { access: "a2", identityKey: "id2", accountId: "acc2", accountLabel: "two@example.com (plus)" }
    ]
    let idx = 0
    const acquireAuth = vi.fn(async () => auths[idx++])
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<(message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>>(async () => {})

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

  it("tags account-switch toast with reason code when switched after 429", async () => {
    const auths = [
      { access: "a1", identityKey: "id1", accountId: "acc1", accountLabel: "one@example.com (plus)" },
      { access: "a2", identityKey: "id2", accountId: "acc2", accountLabel: "two@example.com (plus)" }
    ]
    let idx = 0
    const acquireAuth = vi.fn(async () => auths[idx++])
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<(message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>>(async () => {})

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (idx === 1) {
          return new Response("Too Many Requests", { status: 429, headers: { "Retry-After": "1" } })
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
    expect(
      showToast.mock.calls.some(
        (call) =>
          call[0] === "Account switched after rate limit: two@example.com (plus)" &&
          call[1] === "info" &&
          call[2] === false
      )
    ).toBe(true)
  })

  it("reuses shared session state across orchestrator instances to avoid duplicate new-chat toasts", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "a",
      identityKey: "id1",
      accountId: "acc1",
      accountLabel: "user@example.com (plus)"
    }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<(message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>>(async () => {})
    const sharedState = createFetchOrchestratorState()

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

    const first = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      state: sharedState
    })
    await first.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_shared_1" },
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
      headers: { "content-type": "application/json", session_id: "ses_shared_1" },
      body: JSON.stringify({ prompt_cache_key: "ses_shared_1", input: "second" })
    })

    const newChatToasts = showToast.mock.calls.filter((call) => call[0] === "New chat: user@example.com (plus)")
    expect(newChatToasts).toHaveLength(1)
  })

  it("coalesces rapid new-chat toasts across different sessions", async () => {
    const acquireAuth = vi.fn(async () => ({
      access: "a",
      identityKey: "id1",
      accountId: "acc1",
      accountLabel: "user@example.com (plus)"
    }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<(message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>>(async () => {})
    let nowValue = 1_000

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

    const orch = new FetchOrchestrator({
      acquireAuth,
      setCooldown,
      showToast,
      now: () => nowValue
    })

    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_new_1" },
      body: JSON.stringify({ prompt_cache_key: "ses_new_1", input: "one" })
    })
    nowValue = 2_000
    await orch.execute("https://api.com", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_new_2" },
      body: JSON.stringify({ prompt_cache_key: "ses_new_2", input: "two" })
    })

    const newChatToasts = showToast.mock.calls.filter((call) => call[0] === "New chat: user@example.com (plus)")
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
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<(message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>>(async () => {})
    let nowValue = 1_000

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("OK", { status: 200 }))
    )

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
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const onAttemptRequest = vi.fn<
      (input: { request: Request; attempt: number; maxAttempts: number; sessionKey: string | null }) => Promise<void>
    >(async () => {})
    const onAttemptResponse = vi.fn<
      (input: { response: Response; attempt: number; maxAttempts: number; sessionKey: string | null }) => Promise<void>
    >(async () => {})

    vi.stubGlobal(
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
    vi.stubGlobal("fetch", fetchMock)

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
    vi.stubGlobal(
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

    vi.stubGlobal(
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

    vi.stubGlobal(
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

    vi.stubGlobal(
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
    vi.stubGlobal(
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

    vi.stubGlobal(
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

    vi.stubGlobal(
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
    vi.stubGlobal(
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

  it("prunes toast dedupe maps to bounded sizes", async () => {
    const state = createFetchOrchestratorState()
    for (let index = 0; index < 600; index += 1) {
      state.toastShownAt.set(`toast-${index}`, 0)
      state.rateLimitToastShownAt.set(`rate-${index}`, 0)
    }

    const acquireAuth = vi.fn(async () => ({ access: "a", identityKey: "id-rate", accountLabel: "acct" }))
    const setCooldown = vi.fn<(identityKey: string, cooldownUntil: number) => Promise<void>>(async () => {})
    const showToast = vi.fn<(message: string, variant: "info" | "success" | "warning" | "error", quietMode: boolean) => Promise<void>>(async () => {})

    let fetchCount = 0
    vi.stubGlobal(
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
    vi.stubGlobal(
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
    vi.stubGlobal(
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
