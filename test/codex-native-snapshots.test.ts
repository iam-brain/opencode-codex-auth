import { describe, expect, it, vi } from "vitest"

describe("codex-native snapshots", () => {
  it("persists rate-limit snapshot from response headers for the selected account", async () => {
    vi.resetModules()

    const saveAuthStorage = vi.fn(async (
      _path: string | undefined,
      update: (auth: Record<string, unknown>) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void
    ) => {
      const auth = {
        openai: {
          type: "oauth",
          accounts: [
            {
              identityKey: "acc|u@e.com|plus",
              accountId: "acc",
              enabled: true,
              access: "at",
              refresh: "rt",
              expires: Date.now() + 60_000
            }
          ],
          activeIdentityKey: "acc|u@e.com|plus"
        }
      }
      await update(auth)
      return auth
    })
    const setAccountCooldown = vi.fn(async () => {})
    const saveSnapshots = vi.fn(async (_path: string, update: (current: Record<string, unknown>) => Record<string, unknown>) => {
      return update({})
    })

    vi.doMock("../lib/storage", () => ({
      saveAuthStorage,
      setAccountCooldown
    }))
    vi.doMock("../lib/codex-status-storage", () => ({
      saveSnapshots
    }))

    vi.stubGlobal("fetch", vi.fn(async () => {
      return new Response("ok", {
        status: 200,
        headers: {
          "x-ratelimit-remaining-requests": "75",
          "x-ratelimit-limit-requests": "100",
          "x-ratelimit-reset-requests": "1700"
        }
      })
    }))

    const { CodexAuthPlugin } = await import("../lib/codex-native")
    const hooks = await CodexAuthPlugin({} as never)
    const loader = hooks.auth?.loader
    if (!loader) throw new Error("Missing auth loader")

    const provider = {
      models: {
        "gpt-5.2-codex": { id: "gpt-5.2-codex" }
      }
    }

    const loaded = await loader(
      async () => ({ type: "oauth", refresh: "", access: "", expires: 0 } as never),
      provider as never
    )

    await loaded.fetch?.("https://api.openai.com/v1/responses", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.2-codex", input: "hi" })
    })

    expect(saveSnapshots).toHaveBeenCalledTimes(1)
  })
})
