import { describe, expect, it } from "vitest"

import { isLoopbackRemoteAddress } from "../lib/codex-native/oauth-server"

describe("oauth server loopback guard", () => {
  it("accepts IPv4 and IPv6 loopback addresses", () => {
    expect(isLoopbackRemoteAddress("127.0.0.1")).toBe(true)
    expect(isLoopbackRemoteAddress("127.10.20.30")).toBe(true)
    expect(isLoopbackRemoteAddress("::1")).toBe(true)
    expect(isLoopbackRemoteAddress("::1%lo0")).toBe(true)
    expect(isLoopbackRemoteAddress("::ffff:127.0.0.1")).toBe(true)
  })

  it("rejects non-loopback addresses", () => {
    expect(isLoopbackRemoteAddress(undefined)).toBe(false)
    expect(isLoopbackRemoteAddress("10.0.0.1")).toBe(false)
    expect(isLoopbackRemoteAddress("192.168.1.2")).toBe(false)
    expect(isLoopbackRemoteAddress("::2")).toBe(false)
    expect(isLoopbackRemoteAddress("::ffff:10.0.0.1")).toBe(false)
  })
})
