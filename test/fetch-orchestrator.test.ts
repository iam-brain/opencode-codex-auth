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
})
