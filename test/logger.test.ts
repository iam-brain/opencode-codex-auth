import { describe, expect, it } from "vitest"
import { createLogger } from "../lib/logger"

describe("logger", () => {
  it("does not log debug when disabled", () => {
    const out: string[] = []
    const log = createLogger({ debug: false, sink: (s) => out.push(s) })
    log.debug("hello")
    expect(out.length).toBe(0)
  })

  it("logs debug when enabled", () => {
    const out: string[] = []
    const log = createLogger({ debug: true, sink: (s) => out.push(s) })
    log.debug("hello")
    expect(out.join("\n")).toContain("hello")
  })
})
