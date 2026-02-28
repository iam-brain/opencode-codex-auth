import { describe, expect, it, vi } from "vitest"

describe("persistRateLimitSnapshotFromResponse", () => {
  it("skips persistence when identity key is missing", async () => {
    vi.resetModules()

    const saveSnapshots = vi.fn(async () => ({}))
    vi.doMock("../lib/codex-status-storage", () => ({ saveSnapshots }))

    const { persistRateLimitSnapshotFromResponse } = await import("../lib/codex-native/rate-limit-snapshots")
    const response = new Response("ok", {
      status: 200,
      headers: {
        "x-ratelimit-remaining-requests": "10",
        "x-ratelimit-limit-requests": "100",
        "x-ratelimit-reset-requests": "1700"
      }
    })

    persistRateLimitSnapshotFromResponse(response, undefined)
    await Promise.resolve()

    expect(saveSnapshots).not.toHaveBeenCalled()
  })

  it("skips persistence when response has no parsed limits", async () => {
    vi.resetModules()

    const saveSnapshots = vi.fn(async () => ({}))
    vi.doMock("../lib/codex-status-storage", () => ({ saveSnapshots }))

    const { persistRateLimitSnapshotFromResponse } = await import("../lib/codex-native/rate-limit-snapshots")
    const response = new Response("ok", { status: 200 })

    persistRateLimitSnapshotFromResponse(response, "acc_1|one@example.com|plus")
    await Promise.resolve()

    expect(saveSnapshots).not.toHaveBeenCalled()
  })

  it("persists snapshots under the provided identity key", async () => {
    vi.resetModules()

    const saveSnapshots = vi.fn(async (_path: string, update: (current: Record<string, unknown>) => Record<string, unknown>) =>
      update({})
    )
    vi.doMock("../lib/codex-status-storage", () => ({ saveSnapshots }))

    const { persistRateLimitSnapshotFromResponse } = await import("../lib/codex-native/rate-limit-snapshots")
    const response = new Response("ok", {
      status: 200,
      headers: {
        "x-ratelimit-remaining-requests": "10",
        "x-ratelimit-limit-requests": "100",
        "x-ratelimit-reset-requests": "1700"
      }
    })

    persistRateLimitSnapshotFromResponse(response, "acc_1|one@example.com|plus")
    await Promise.resolve()

    expect(saveSnapshots).toHaveBeenCalledTimes(1)
    const update = saveSnapshots.mock.calls[0]?.[1] as (current: Record<string, unknown>) => Record<string, unknown>
    const next = update({})
    expect(Object.keys(next)).toEqual(["acc_1|one@example.com|plus"])
  })

  it("does not throw when snapshot persistence fails", async () => {
    vi.resetModules()

    const saveSnapshots = vi.fn(async () => {
      throw new Error("disk unavailable")
    })
    vi.doMock("../lib/codex-status-storage", () => ({ saveSnapshots }))

    const { persistRateLimitSnapshotFromResponse } = await import("../lib/codex-native/rate-limit-snapshots")
    const response = new Response("ok", {
      status: 200,
      headers: {
        "x-ratelimit-remaining-requests": "10",
        "x-ratelimit-limit-requests": "100",
        "x-ratelimit-reset-requests": "1700"
      }
    })

    expect(() => persistRateLimitSnapshotFromResponse(response, "acc_1|one@example.com|plus")).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(saveSnapshots).toHaveBeenCalledTimes(1)
  })
})
