import { EventEmitter } from "node:events"

import { afterEach, describe, expect, it, vi } from "vitest"

import { confirm } from "../lib/ui/tty/confirm.js"
import { ANSI, parseKey } from "../lib/ui/tty/ansi.js"
import { select } from "../lib/ui/tty/select.js"

type MockInput = NodeJS.ReadStream & {
  isTTY: boolean
  isRaw: boolean
  setRawMode: ReturnType<typeof vi.fn>
  resume: ReturnType<typeof vi.fn>
  pause: ReturnType<typeof vi.fn>
}

type MockOutput = NodeJS.WriteStream & {
  isTTY: boolean
  columns: number
  writes: string[]
  write: ReturnType<typeof vi.fn>
}

function createMockTTY(): { input: MockInput; output: MockOutput } {
  const input = new EventEmitter() as MockInput
  input.isTTY = true
  input.isRaw = false
  input.setRawMode = vi.fn((value: boolean) => {
    input.isRaw = value
    return input
  })
  input.resume = vi.fn()
  input.pause = vi.fn()

  const output = new EventEmitter() as MockOutput
  output.isTTY = true
  output.columns = 80
  output.writes = []
  output.write = vi.fn((chunk: string | Uint8Array) => {
    output.writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"))
    return true
  })

  return { input, output }
}

describe("tty select primitives", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("parses core key actions", () => {
    expect(parseKey(Buffer.from("\x1b[A"))).toBe("up")
    expect(parseKey(Buffer.from("\x1b[B"))).toBe("down")
    expect(parseKey(Buffer.from("\r"))).toBe("enter")
    expect(parseKey(Buffer.from("\x03"))).toBe("escape")
  })

  it("supports keyboard navigation and restores TTY state", async () => {
    const { input, output } = createMockTTY()

    const resultPromise = select(
      [
        { label: "First", value: "first" },
        { label: "Second", value: "second" }
      ],
      {
        message: "Pick one",
        input,
        output,
        useColor: false
      }
    )

    input.emit("data", Buffer.from("\x1b[B"))
    input.emit("data", Buffer.from("\r"))

    await expect(resultPromise).resolves.toBe("second")
    expect(input.setRawMode).toHaveBeenNthCalledWith(1, true)
    expect(input.setRawMode).toHaveBeenLastCalledWith(false)
    expect(output.write).toHaveBeenCalledWith(ANSI.hide)
    expect(output.write).toHaveBeenCalledWith(ANSI.show)
  })

  it("cancels selection when escape-start timeout elapses", async () => {
    vi.useFakeTimers()
    const { input, output } = createMockTTY()

    const resultPromise = select(
      [
        { label: "A", value: "a" },
        { label: "B", value: "b" }
      ],
      {
        message: "Pick one",
        input,
        output,
        useColor: false
      }
    )

    input.emit("data", Buffer.from("\x1b"))
    vi.advanceTimersByTime(60)

    await expect(resultPromise).resolves.toBeNull()
  })

  it("drives confirm through select choices", async () => {
    const { input, output } = createMockTTY()
    const resultPromise = confirm("Continue?", false, { input, output, useColor: false })
    input.emit("data", Buffer.from("\x1b[B"))
    input.emit("data", Buffer.from("\r"))
    await expect(resultPromise).resolves.toBe(true)
  })
})
