import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchQuotaSnapshotFromBackend } from "../lib/codex-quota-fetch"

describe("codex quota fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("parses wham usage response into requests/tokens limits", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            rate_limit: {
              primary_window: {
                used_percent: 25,
                limit_window_seconds: 18000,
                reset_at: 1_710_000_000
              },
              secondary_window: {
                used_percent: 70,
                limit_window_seconds: 604800,
                reset_at: 1_711_000_000
              }
            },
            credits: {
              has_credits: true,
              unlimited: false,
              balance: "12.5"
            }
          }),
          { status: 200 }
        )
    )
    vi.stubGlobal("fetch", fetchMock)

    const snapshot = await fetchQuotaSnapshotFromBackend({
      accessToken: "ey.a.jwt",
      accountId: "acc_1",
      now: 111,
      modelFamily: "gpt-5.3-codex",
      userAgent: "test-agent"
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://chatgpt.com/backend-api/wham/usage")
    expect(snapshot?.limits).toEqual([
      { name: "requests", leftPct: 75, resetsAt: 1_710_000_000_000 },
      { name: "tokens", leftPct: 30, resetsAt: 1_711_000_000_000 }
    ])
    expect(snapshot?.credits).toEqual({
      hasCredits: true,
      unlimited: false,
      balance: "12.5"
    })
  })

  it("resolves codex-api usage path for non-backend base URLs", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            rate_limit: {
              primary_window: {
                used_percent: 10,
                limit_window_seconds: 18000,
                reset_at: 1_712_000_000
              }
            }
          }),
          { status: 200 }
        )
    )
    vi.stubGlobal("fetch", fetchMock)

    const snapshot = await fetchQuotaSnapshotFromBackend({
      accessToken: "ey.a.jwt",
      accountId: "acc_1",
      baseUrl: "https://api.openai.com",
      now: 222,
      modelFamily: "gpt-5.3-codex",
      userAgent: "test-agent"
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/api/codex/usage")
    expect(snapshot?.limits).toEqual([{ name: "requests", leftPct: 90, resetsAt: 1_712_000_000_000 }])
  })

  it("routes quota requests with ChatGPT-Account-Id header for account isolation parity", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            rate_limit: {
              primary_window: {
                used_percent: 50,
                reset_at: 1_713_000_000
              }
            }
          }),
          { status: 200 }
        )
    )
    vi.stubGlobal("fetch", fetchMock)

    await fetchQuotaSnapshotFromBackend({
      accessToken: "ey.a.jwt",
      accountId: "acc_team_123",
      now: 333,
      modelFamily: "gpt-5.3-codex",
      userAgent: "test-agent"
    })

    const init = fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined
    expect(init?.headers?.["ChatGPT-Account-Id"]).toBe("acc_team_123")
    expect(init?.headers?.["OpenAI-Account-Id"]).toBeUndefined()
    expect(init?.headers?.Origin).toBeUndefined()
  })

  it("normalizes chatgpt base URL to backend-api before usage lookup", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            rate_limit: {
              primary_window: {
                used_percent: 10,
                reset_at: 1_712_000_000
              }
            }
          }),
          { status: 200 }
        )
    )
    vi.stubGlobal("fetch", fetchMock)

    await fetchQuotaSnapshotFromBackend({
      accessToken: "ey.a.jwt",
      accountId: "acc_1",
      baseUrl: "https://chatgpt.com",
      now: 444,
      modelFamily: "gpt-5.3-codex",
      userAgent: "test-agent"
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://chatgpt.com/backend-api/wham/usage")
  })

  it("returns null for non-success usage responses without fallback requests", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 500 }))
    vi.stubGlobal("fetch", fetchMock)

    const snapshot = await fetchQuotaSnapshotFromBackend({
      accessToken: "ey.a.jwt",
      accountId: "acc_1",
      now: 555,
      modelFamily: "gpt-5.3-codex",
      userAgent: "test-agent"
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(snapshot).toBeNull()
  })

  it("aborts quota fetch when timeout elapses and returns null", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal
      return await new Promise<Response>((_resolve, reject) => {
        if (!signal) {
          reject(new Error("missing signal"))
          return
        }
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })
      })
    })

    const snapshot = await fetchQuotaSnapshotFromBackend({
      accessToken: "ey.a.jwt",
      accountId: "acc_1",
      timeoutMs: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(snapshot).toBeNull()
  })
})
