import { describe, expect, it, vi } from "vitest"
import { FetchOrchestrator } from "../lib/fetch-orchestrator"

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
})
