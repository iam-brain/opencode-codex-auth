import { describe, expect, it } from "vitest"

import { createStickySessionState, selectAccount } from "../lib/rotation"
import type { AccountRecord } from "../lib/types"

describe("rotation", () => {
  it("round_robin moves from a to b", () => {
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: true },
      { identityKey: "b", enabled: true }
    ]

    const selected = selectAccount({
      accounts,
      strategy: "round_robin",
      activeIdentityKey: "a",
      now: Date.now()
    })

    expect(selected?.identityKey).toBe("b")
  })

  it("defaults to sticky when strategy omitted", () => {
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: true },
      { identityKey: "b", enabled: true }
    ]

    const selected = selectAccount({
      accounts,
      activeIdentityKey: "a",
      now: Date.now()
    })

    expect(selected?.identityKey).toBe("a")
  })

  it("round_robin returns first eligible when active missing", () => {
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: true },
      { identityKey: "b", enabled: true }
    ]

    const selected = selectAccount({
      accounts,
      strategy: "round_robin",
      activeIdentityKey: "missing",
      now: Date.now()
    })

    expect(selected?.identityKey).toBe("a")
  })

  it("round_robin wraps from last to first", () => {
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: true },
      { identityKey: "b", enabled: true },
      { identityKey: "c", enabled: true }
    ]

    const selected = selectAccount({
      accounts,
      strategy: "round_robin",
      activeIdentityKey: "c",
      now: Date.now()
    })

    expect(selected?.identityKey).toBe("a")
  })

  it("sticky keeps active", () => {
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: true },
      { identityKey: "b", enabled: true }
    ]

    const selected = selectAccount({
      accounts,
      strategy: "sticky",
      activeIdentityKey: "a",
      now: Date.now()
    })

    expect(selected?.identityKey).toBe("a")
  })

  it("hybrid picks least recently used when active missing", () => {
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: true, lastUsed: 100 },
      { identityKey: "b", enabled: true, lastUsed: 200 }
    ]

    const selected = selectAccount({
      accounts,
      strategy: "hybrid",
      activeIdentityKey: "missing",
      now: Date.now()
    })

    expect(selected?.identityKey).toBe("a")
  })

  it("skips disabled accounts (including active)", () => {
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: false, lastUsed: 999 },
      { identityKey: "b", enabled: true, lastUsed: 1 }
    ]

    expect(
      selectAccount({
        accounts,
        strategy: "sticky",
        activeIdentityKey: "a",
        now: Date.now()
      })?.identityKey
    ).toBe("b")

    expect(
      selectAccount({
        accounts,
        strategy: "hybrid",
        activeIdentityKey: "missing",
        now: Date.now()
      })?.identityKey
    ).toBe("b")
  })

  it("excludes accounts still in cooldown", () => {
    const now = 1000
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: true, cooldownUntil: now + 1 },
      { identityKey: "b", enabled: true }
    ]

    expect(
      selectAccount({
        accounts,
        strategy: "sticky",
        activeIdentityKey: "a",
        now
      })?.identityKey
    ).toBe("b")

    expect(
      selectAccount({
        accounts,
        strategy: "round_robin",
        activeIdentityKey: "b",
        now
      })?.identityKey
    ).toBe("b")
  })

  it("sticky session mode rotates to next healthy account for new sessions", () => {
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: true },
      { identityKey: "b", enabled: true },
      { identityKey: "c", enabled: true }
    ]
    const stickySessionState = createStickySessionState()

    expect(
      selectAccount({
        accounts,
        strategy: "sticky",
        now: 1000,
        stickyPidOffset: true,
        stickySessionKey: "ses-1",
        stickySessionState
      })?.identityKey
    ).toBe("a")

    expect(
      selectAccount({
        accounts,
        strategy: "sticky",
        now: 1000,
        stickyPidOffset: true,
        stickySessionKey: "ses-2",
        stickySessionState
      })?.identityKey
    ).toBe("b")

    expect(
      selectAccount({
        accounts,
        strategy: "sticky",
        now: 1000,
        stickyPidOffset: true,
        stickySessionKey: "ses-1",
        stickySessionState
      })?.identityKey
    ).toBe("a")
  })

  it("sticky session mode reassigns when assigned account is no longer healthy", () => {
    const stickySessionState = createStickySessionState()
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: true, cooldownUntil: 2_000 },
      { identityKey: "b", enabled: true }
    ]

    stickySessionState.bySessionKey.set("ses-1", "a")

    expect(
      selectAccount({
        accounts,
        strategy: "sticky",
        now: 1000,
        stickyPidOffset: true,
        stickySessionKey: "ses-1",
        stickySessionState
      })?.identityKey
    ).toBe("b")
  })

  it("sticky ignores session assignment and keeps active when pid offset disabled", () => {
    const stickySessionState = createStickySessionState()
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: true },
      { identityKey: "b", enabled: true }
    ]

    expect(
      selectAccount({
        accounts,
        strategy: "sticky",
        activeIdentityKey: "a",
        now: 1000,
        stickySessionKey: "ses-1",
        stickySessionState
      })?.identityKey
    ).toBe("a")

    expect(
      selectAccount({
        accounts,
        strategy: "sticky",
        activeIdentityKey: "a",
        now: 1000,
        stickySessionKey: "ses-2",
        stickySessionState
      })?.identityKey
    ).toBe("a")
  })

  it("hybrid reuses active account when pid offset disabled", () => {
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: true, lastUsed: 500 },
      { identityKey: "b", enabled: true, lastUsed: 100 }
    ]

    expect(
      selectAccount({
        accounts,
        strategy: "hybrid",
        activeIdentityKey: "a",
        now: 1000
      })?.identityKey
    ).toBe("a")
  })

  it("hybrid assigns per-session and reuses assignment when pid offset enabled", () => {
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: true, lastUsed: 100 },
      { identityKey: "b", enabled: true, lastUsed: 200 },
      { identityKey: "c", enabled: true, lastUsed: 300 }
    ]
    const stickySessionState = createStickySessionState()

    expect(
      selectAccount({
        accounts,
        strategy: "hybrid",
        now: 1000,
        stickyPidOffset: true,
        stickySessionKey: "ses-1",
        stickySessionState
      })?.identityKey
    ).toBe("a")

    expect(
      selectAccount({
        accounts,
        strategy: "hybrid",
        now: 1000,
        stickyPidOffset: true,
        stickySessionKey: "ses-2",
        stickySessionState
      })?.identityKey
    ).toBe("b")

    expect(
      selectAccount({
        accounts,
        strategy: "hybrid",
        now: 1000,
        stickyPidOffset: true,
        stickySessionKey: "ses-1",
        stickySessionState
      })?.identityKey
    ).toBe("a")
  })

  it("sticky applies pid offset when no active or session assignment exists", () => {
    const accounts: AccountRecord[] = [
      { identityKey: "a", enabled: true },
      { identityKey: "b", enabled: true },
      { identityKey: "c", enabled: true }
    ]

    expect(
      selectAccount({
        accounts,
        strategy: "sticky",
        now: 1000,
        stickyPidOffset: true,
        pid: 4
      })?.identityKey
    ).toBe("b")
  })
})
