import { describe, expect, it, vi } from "vitest"
import { createBrowserOAuthAuthorize } from "../lib/codex-native/oauth-auth-methods"

describe("createBrowserOAuthAuthorize", () => {
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
})
