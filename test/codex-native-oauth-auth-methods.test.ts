import { afterEach, describe, expect, it, vi } from "vitest"

import { resetStubbedGlobals, stubGlobalForTest } from "./helpers/mock-policy"

import { createBrowserOAuthAuthorize, createHeadlessOAuthAuthorize } from "../lib/codex-native/oauth-auth-methods"

describe("createBrowserOAuthAuthorize", () => {
  afterEach(() => {
    resetStubbedGlobals()
  })

  it("schedules error shutdown when non-interactive callback fails", async () => {
    const scheduleOAuthServerStop = vi.fn()
    const persistOAuthTokens = vi.fn()
    const openAuthUrl = vi.fn()

    const authorize = createBrowserOAuthAuthorize({
      authMode: "native",
      spoofMode: "native",
      runInteractiveAuthMenu: vi.fn<(options: { allowExit: boolean }) => Promise<"add" | "exit">>(async () => "exit"),
      startOAuthServer: vi.fn(async () => ({ redirectUri: "http://localhost:1455/auth/callback" })),
      waitForOAuthCallback: vi.fn(async () => {
        throw new Error("callback failed")
      }),
      scheduleOAuthServerStop,
      persistOAuthTokens,
      openAuthUrl,
      shutdownGraceMs: 1_000,
      shutdownErrorGraceMs: 5_000
    })

    const payload = await authorize()
    await expect(payload.callback()).resolves.toEqual({ type: "failed" })
    expect(persistOAuthTokens).not.toHaveBeenCalled()
    expect(openAuthUrl).toHaveBeenCalledTimes(1)
    expect(scheduleOAuthServerStop).toHaveBeenCalledWith(5_000, "error")
  })

  it("returns the last successful tokens when interactive auth exits after an add", async () => {
    const scheduleOAuthServerStop = vi.fn()
    const persistOAuthTokens = vi.fn(async () => {})
    const openAuthUrl = vi.fn()
    const runInteractiveAuthMenu = vi
      .fn<(options: { allowExit: boolean }) => Promise<"add" | "exit">>()
      .mockResolvedValueOnce("add")
      .mockResolvedValueOnce("exit")
    const waitForOAuthCallback = vi.fn(async () => ({
      refresh_token: "rt_last",
      access_token: "at_last",
      expires_in: 1200
    }))

    const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean }
    const stdout = process.stdout as NodeJS.WriteStream & { isTTY?: boolean }
    const previousIn = stdin.isTTY
    const previousOut = stdout.isTTY
    stdin.isTTY = true
    stdout.isTTY = true

    try {
      const authorize = createBrowserOAuthAuthorize({
        authMode: "codex",
        spoofMode: "codex",
        runInteractiveAuthMenu,
        startOAuthServer: vi.fn(async () => ({ redirectUri: "http://localhost:1455/auth/callback" })),
        waitForOAuthCallback,
        scheduleOAuthServerStop,
        persistOAuthTokens,
        openAuthUrl,
        shutdownGraceMs: 1_000,
        shutdownErrorGraceMs: 5_000
      })

      const payload = await authorize({})
      expect(payload.url).toBe("")
      await expect(payload.callback()).resolves.toMatchObject({
        type: "success",
        refresh: "rt_last",
        access: "at_last"
      })
      expect(runInteractiveAuthMenu).toHaveBeenCalledTimes(2)
      expect(waitForOAuthCallback).toHaveBeenCalledTimes(1)
      expect(persistOAuthTokens).toHaveBeenCalledTimes(1)
      expect(openAuthUrl).toHaveBeenCalledTimes(1)
      expect(scheduleOAuthServerStop).toHaveBeenCalledWith(1_000, "success")
    } finally {
      stdin.isTTY = previousIn
      stdout.isTTY = previousOut
    }
  })
})

describe("createHeadlessOAuthAuthorize", () => {
  afterEach(() => {
    resetStubbedGlobals()
  })

  it("returns failed when device polling gets a fatal oauth error", async () => {
    let pollCount = 0
    stubGlobalForTest(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString()
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
          return new Response(JSON.stringify({ error: "expired_token" }), {
            status: 400,
            headers: { "content-type": "application/json" }
          })
        }

        throw new Error(`unexpected URL: ${url}`)
      })
    )

    const persistOAuthTokens = vi.fn(async () => {})
    const authorize = createHeadlessOAuthAuthorize({
      spoofMode: "native",
      persistOAuthTokens
    })

    const payload = await authorize()
    await expect(payload.callback()).resolves.toEqual({ type: "failed" })
    expect(pollCount).toBe(1)
    expect(persistOAuthTokens).not.toHaveBeenCalled()
  })
})
