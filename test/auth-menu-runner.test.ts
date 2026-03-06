import { PassThrough } from "node:stream"

import { describe, expect, it, vi } from "vitest"

import { runAuthMenuOnce } from "../lib/ui/auth-menu"

async function tick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

function makeTty() {
  const input = new PassThrough()
  const output = new PassThrough()
  ;(input as unknown as { isTTY: boolean }).isTTY = true
  ;(output as unknown as { isTTY: boolean }).isTTY = true
  ;(input as unknown as { setRawMode: (val: boolean) => void }).setRawMode = vi.fn()
  return { input, output }
}

describe("auth menu runner", () => {
  it("returns add when selecting add new account", async () => {
    const { input, output } = makeTty()
    const resultPromise = runAuthMenuOnce({
      accounts: [],
      handlers: {
        onCheckQuotas: vi.fn(),
        onConfigureModels: vi.fn(),
        onDeleteAll: vi.fn(),
        onTransfer: vi.fn(),
        onToggleAccount: vi.fn(),
        onRefreshAccount: vi.fn(),
        onDeleteAccount: vi.fn()
      },
      input: input as unknown as NodeJS.ReadStream,
      output: output as unknown as NodeJS.WriteStream
    })

    await tick()
    input.write("\r")
    const result = await resultPromise
    expect(result).toBe("add")
  })

  it("invokes quota handler and continues", async () => {
    const { input, output } = makeTty()
    const onCheckQuotas = vi.fn()
    const resultPromise = runAuthMenuOnce({
      accounts: [],
      handlers: {
        onCheckQuotas,
        onConfigureModels: vi.fn(),
        onDeleteAll: vi.fn(),
        onTransfer: vi.fn(),
        onToggleAccount: vi.fn(),
        onRefreshAccount: vi.fn(),
        onDeleteAccount: vi.fn()
      },
      input: input as unknown as NodeJS.ReadStream,
      output: output as unknown as NodeJS.WriteStream
    })

    await tick()
    input.write("\u001b[B")
    input.write("\r")
    const result = await resultPromise
    expect(result).toBe("continue")
    expect(onCheckQuotas).toHaveBeenCalledTimes(1)
  })

  it("invokes transfer handler when transfer action is selected", async () => {
    const { input, output } = makeTty()
    const onTransfer = vi.fn()
    const resultPromise = runAuthMenuOnce({
      accounts: [],
      allowTransfer: true,
      handlers: {
        onCheckQuotas: vi.fn(),
        onConfigureModels: vi.fn(),
        onDeleteAll: vi.fn(),
        onTransfer,
        onToggleAccount: vi.fn(),
        onRefreshAccount: vi.fn(),
        onDeleteAccount: vi.fn()
      },
      input: input as unknown as NodeJS.ReadStream,
      output: output as unknown as NodeJS.WriteStream
    })

    await tick()
    input.write("\u001b[B")
    input.write("\u001b[B")
    input.write("\u001b[B")
    input.write("\u001b[B")
    input.write("\r")
    const result = await resultPromise
    expect(result).toBe("continue")
    expect(onTransfer).toHaveBeenCalledTimes(1)
  })

  it("passes scoped delete-all from the top-level menu", async () => {
    const accounts = [
      {
        index: 0,
        identityKey: "acc_1|one@example.com|plus",
        email: "one@example.com",
        plan: "plus",
        enabled: true,
        authTypes: ["native", "codex"] as const
      }
    ]

    vi.doMock("../lib/ui/tty.js", async () => {
      const actual = await vi.importActual<typeof import("../lib/ui/tty.js")>("../lib/ui/tty.js")
      return {
        ...actual,
        select: vi.fn().mockResolvedValueOnce({ type: "delete-all", scope: "both" }).mockResolvedValueOnce("codex"),
        confirm: vi.fn(async () => true),
        shouldUseColor: vi.fn(() => false)
      }
    })

    vi.resetModules()
    const { runAuthMenuOnce: runMockedAuthMenuOnce } = await import("../lib/ui/auth-menu")
    const onDeleteAll = vi.fn()

    const result = await runMockedAuthMenuOnce({
      accounts,
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
    vi.doUnmock("../lib/ui/tty.js")
    vi.resetModules()
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

    vi.doMock("../lib/ui/tty.js", async () => {
      const actual = await vi.importActual<typeof import("../lib/ui/tty.js")>("../lib/ui/tty.js")
      return {
        ...actual,
        select: vi
          .fn()
          .mockResolvedValueOnce({ type: "select-account", account })
          .mockResolvedValueOnce({ type: "delete", scope: "codex" }),
        confirm: vi.fn(async () => true),
        shouldUseColor: vi.fn(() => false)
      }
    })

    vi.resetModules()
    const { runAuthMenuOnce: runMockedAuthMenuOnce } = await import("../lib/ui/auth-menu")
    const onDeleteAccount = vi.fn()

    const result = await runMockedAuthMenuOnce({
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
    vi.doUnmock("../lib/ui/tty.js")
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

    vi.doMock("../lib/ui/tty.js", async () => {
      const actual = await vi.importActual<typeof import("../lib/ui/tty.js")>("../lib/ui/tty.js")
      return {
        ...actual,
        select: vi
          .fn()
          .mockResolvedValueOnce({ type: "manage" })
          .mockResolvedValueOnce(account)
          .mockResolvedValueOnce({ type: "delete-all", scope: "native" }),
        confirm: vi.fn(async () => true),
        shouldUseColor: vi.fn(() => false)
      }
    })

    vi.resetModules()
    const { runAuthMenuOnce: runMockedAuthMenuOnce } = await import("../lib/ui/auth-menu")
    const onDeleteAll = vi.fn()

    const result = await runMockedAuthMenuOnce({
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
    vi.doUnmock("../lib/ui/tty.js")
    vi.resetModules()
  })
})
