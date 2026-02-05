import { describe, expect, it, vi } from "vitest"

describe("proactive refresh locking", () => {
  it("does not use loadAuthStorage plus separate writes", async () => {
    vi.resetModules()

    const loadAuthStorage = vi.fn(async () => ({}))
    const auth = {
      openai: {
        type: "oauth",
        accounts: [
          {
            identityKey: "acc|u@e.com|plus",
            enabled: true,
            refresh: "rt",
            expires: 0
          }
        ]
      }
    }
    const saveAuthStorage = vi.fn(
      async (
        _path: string | undefined,
        update: (auth: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown> | void> | void
      ) => {
        await update(auth)
        return auth
      }
    )
    const updateAccountTokensByIdentityKey = vi.fn()

    vi.doMock("../lib/storage", () => ({
      loadAuthStorage,
      saveAuthStorage,
      updateAccountTokensByIdentityKey
    }))

    const { runOneProactiveRefreshTick } = await import("../lib/proactive-refresh")

    await runOneProactiveRefreshTick({
      authPath: "x",
      now: () => 100,
      bufferMs: 1000,
      refresh: async () => ({ access: "a", refresh: "r", expires: 5000 })
    })

    expect(loadAuthStorage).not.toHaveBeenCalled()
    expect(saveAuthStorage).toHaveBeenCalled()
  })
})
