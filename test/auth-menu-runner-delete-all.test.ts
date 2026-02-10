import { afterEach, describe, expect, it, vi } from "vitest"

describe("auth menu runner delete-all", () => {
  afterEach(() => {
    vi.resetModules()
  })

  it("invokes delete-all handler from account-management submenu", async () => {
    const account = {
      index: 0,
      identityKey: "acc_1|one@example.com|plus",
      email: "one@example.com",
      plan: "plus",
      enabled: true,
      authTypes: ["native"] as const
    }

    vi.doMock("../lib/ui/auth-menu", () => ({
      showAuthMenu: vi.fn(async () => ({ type: "manage" })),
      selectAccount: vi.fn(async () => account),
      showAccountDetails: vi.fn(async () => ({ type: "delete-all", scope: "native" }))
    }))

    const { runAuthMenuOnce } = await import("../lib/ui/auth-menu-runner")

    const onDeleteAll = vi.fn()
    const result = await runAuthMenuOnce({
      accounts: [account],
      handlers: {
        onCheckQuotas: vi.fn(),
        onConfigureModels: vi.fn(),
        onDeleteAll,
        onTransfer: vi.fn(),
        onToggleAccount: vi.fn(),
        onRefreshAccount: vi.fn(),
        onDeleteAccount: vi.fn()
      }
    })

    expect(result).toBe("continue")
    expect(onDeleteAll).toHaveBeenCalledTimes(1)
    expect(onDeleteAll).toHaveBeenCalledWith("native")
  })
})
