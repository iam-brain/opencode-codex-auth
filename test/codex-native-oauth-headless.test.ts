import { describe, expect, it, vi } from "vitest"

describe("createHeadlessOAuthAuthorize", () => {
  it("backs off polling delay when device auth returns slow_down", async () => {
    vi.resetModules()

    const sleep = vi.fn(async (_ms: number) => {})
    let pollCount = 0
    const fetchWithTimeout = vi.fn(async (url: string) => {
      if (url.endsWith("/api/accounts/deviceauth/usercode")) {
        return new Response(
          JSON.stringify({
            device_auth_id: "device_1",
            user_code: "ABC123",
            interval: "1"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      }

      if (url.endsWith("/api/accounts/deviceauth/token")) {
        pollCount += 1
        if (pollCount === 1) {
          return new Response(JSON.stringify({ error: "slow_down" }), {
            status: 400,
            headers: { "content-type": "application/json" }
          })
        }
        return new Response(
          JSON.stringify({
            authorization_code: "auth_code_1",
            code_verifier: "verifier_1"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      }

      if (url.endsWith("/oauth/token")) {
        return new Response(
          JSON.stringify({
            refresh_token: "rt_1",
            access_token: "at_1",
            expires_in: 3600
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      }

      throw new Error(`unexpected URL: ${url}`)
    })

    vi.doMock("../lib/codex-native/oauth-utils", async () => {
      const actual = await vi.importActual<typeof import("../lib/codex-native/oauth-utils")>(
        "../lib/codex-native/oauth-utils"
      )
      return {
        ...actual,
        fetchWithTimeout,
        sleep
      }
    })

    const { createHeadlessOAuthAuthorize } = await import("../lib/codex-native/oauth-auth-methods")
    const persistOAuthTokens = vi.fn(async () => {})

    const authorize = createHeadlessOAuthAuthorize({
      spoofMode: "native",
      persistOAuthTokens
    })

    const payload = await authorize()
    const result = await payload.callback()

    expect(result.type).toBe("success")
    expect(pollCount).toBe(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    const delay = sleep.mock.calls.at(0)?.[0]
    expect(delay).toBeTypeOf("number")
    if (typeof delay !== "number") throw new Error("expected numeric delay")
    expect(delay).toBeGreaterThan(1_000)
  })
})
