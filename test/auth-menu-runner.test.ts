import { PassThrough } from "node:stream"

import { describe, expect, it, vi } from "vitest"

import { runAuthMenuOnce } from "../lib/ui/auth-menu-runner"

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
})
