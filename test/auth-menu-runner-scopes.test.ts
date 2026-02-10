import { afterEach, describe, expect, it, vi } from "vitest"

describe("auth menu runner scoped delete actions", () => {
  afterEach(() => {
    vi.resetModules()
  })

  it("passes scoped delete-all from the top-level menu", async () => {
    vi.doMock("../lib/ui/auth-menu", () => ({
      showAuthMenu: vi.fn(async () => ({ type: "delete-all", scope: "codex" })),
      selectAccount: vi.fn(async () => null),
      showAccountDetails: vi.fn(async () => ({ type: "cancel" }))
    }))

    const { runAuthMenuOnce } = await import("../lib/ui/auth-menu-runner")
    const onDeleteAll = vi.fn()

    const result = await runAuthMenuOnce({
      accounts: [],
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
    expect(onDeleteAll).toHaveBeenCalledWith("codex")
  })

  it("passes scoped account delete from account details", async () => {
    const account = {
      index: 0,
      identityKey: "acc_1|one@example.com|plus",
      email: "one@example.com",
      plan: "plus",
      enabled: true,
      authTypes: ["native", "codex"] as const
    }

    vi.doMock("../lib/ui/auth-menu", () => ({
      showAuthMenu: vi.fn(async () => ({ type: "select-account", account })),
      selectAccount: vi.fn(async () => account),
      showAccountDetails: vi.fn(async () => ({ type: "delete", scope: "codex" }))
    }))

    const { runAuthMenuOnce } = await import("../lib/ui/auth-menu-runner")
    const onDeleteAccount = vi.fn()

    const result = await runAuthMenuOnce({
      accounts: [account],
      handlers: {
        onCheckQuotas: vi.fn(),
        onConfigureModels: vi.fn(),
        onDeleteAll: vi.fn(),
        onTransfer: vi.fn(),
        onToggleAccount: vi.fn(),
        onRefreshAccount: vi.fn(),
        onDeleteAccount
      }
    })

    expect(result).toBe("continue")
    expect(onDeleteAccount).toHaveBeenCalledWith(account, "codex")
  })
})
