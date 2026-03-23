import { afterEach, describe, expect, it, vi } from "vitest"
import { refreshAccessToken } from "../lib/codex-native/oauth-utils"
import { resetStubbedGlobals, stubGlobalForTest } from "./helpers/mock-policy"

describe("codex-native oauth utils", () => {
  afterEach(() => {
    resetStubbedGlobals()
  })

  it("refreshes access tokens from the oauth token endpoint", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: "access_next", refresh_token: "refresh_next", expires_in: 3600 }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
    )
    stubGlobalForTest("fetch", fetchMock)

    const tokens = await refreshAccessToken("refresh_current")

    expect(tokens).toEqual({
      access_token: "access_next",
      refresh_token: "refresh_next",
      expires_in: 3600
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls.at(0)
    expect(call).toBeDefined()
    if (!call) {
      throw new Error("expected fetch call")
    }
    const [input, init] = call as unknown as [RequestInfo | URL, RequestInit | undefined]
    expect(typeof input === "string" ? input : input.toString()).toBe("https://auth.openai.com/oauth/token")
    expect(init?.method).toBe("POST")
    expect(init?.headers).toEqual({ "Content-Type": "application/x-www-form-urlencoded" })
    expect(String(init?.body)).toContain("grant_type=refresh_token")
    expect(String(init?.body)).toContain("refresh_token=refresh_current")
  })

  it("surfaces top-level oauth error descriptions on refresh failures", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "invalid_grant", error_description: "Refresh token expired" }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        })
    )
    stubGlobalForTest("fetch", fetchMock)

    await expect(refreshAccessToken("refresh_expired")).rejects.toMatchObject({
      message: "Token refresh failed (invalid_grant)",
      status: 400,
      oauthCode: "invalid_grant",
      oauthMessage: "Refresh token expired"
    })
  })

  it("surfaces nested oauth error payloads on refresh failures", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { code: "refresh_token_reused", message: "Refresh token reused" } }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        })
    )
    stubGlobalForTest("fetch", fetchMock)

    await expect(refreshAccessToken("refresh_reused")).rejects.toMatchObject({
      message: "Token refresh failed (refresh_token_reused)",
      status: 401,
      oauthCode: "refresh_token_reused",
      oauthMessage: "Refresh token reused"
    })
  })

  it("falls back to status details when the oauth error body is not json", async () => {
    const fetchMock = vi.fn(async () => new Response("not json", { status: 502 }))
    stubGlobalForTest("fetch", fetchMock)

    await expect(refreshAccessToken("refresh_unknown")).rejects.toMatchObject({
      message: "Token refresh failed (status 502)",
      status: 502,
      oauthCode: undefined,
      oauthMessage: undefined
    })
  })
})
