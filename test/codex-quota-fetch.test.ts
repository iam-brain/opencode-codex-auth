import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchQuotaSnapshotFromBackend } from "../lib/codex-quota-fetch"

describe("codex quota fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("parses wham usage response into requests/tokens limits", async () => {
    const fetchMock = vi.fn(async () =>
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

  it("falls back to codex usage endpoint when preferred endpoint fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(
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
      now: 222,
      modelFamily: "gpt-5.3-codex",
      userAgent: "test-agent"
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://chatgpt.com/backend-api/wham/usage")
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.openai.com/api/codex/usage")
    expect(snapshot?.limits).toEqual([
      { name: "requests", leftPct: 90, resetsAt: 1_712_000_000_000 }
    ])
  })
})
