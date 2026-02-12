import { describe, expect, it, vi } from "vitest"

import { createRefreshScheduler, ProactiveRefreshQueue } from "../lib/refresh-queue"

describe("ProactiveRefreshQueue", () => {
  it("enqueues tasks and pops due ones", () => {
    const q = new ProactiveRefreshQueue({ bufferMs: 10_000 })
    q.enqueue({ key: "a", expiresAt: 50_000 })
    q.enqueue({ key: "b", expiresAt: 80_000 })

    const dueAt60 = q.due(60_000)
    expect(dueAt60.map((t) => t.key)).toEqual(["a"])
  })

  it("sorts due tasks by expiresAt", () => {
    const q = new ProactiveRefreshQueue({ bufferMs: 0 })
    q.enqueue({ key: "later", expiresAt: 100 })
    q.enqueue({ key: "sooner", expiresAt: 50 })

    const due = q.due(100)
    expect(due.map((t) => t.key)).toEqual(["sooner", "later"])
  })

  it("removes tasks", () => {
    const q = new ProactiveRefreshQueue({ bufferMs: 0 })
    q.enqueue({ key: "a", expiresAt: 50 })
    q.remove("a")

    expect(q.due(100)).toEqual([])
  })
})

describe("refresh scheduler", () => {
  it("polls and calls refresh for due tasks", async () => {
    vi.useFakeTimers()
    const q = new ProactiveRefreshQueue({ bufferMs: 10_000 })
    q.enqueue({ key: "a", expiresAt: 50_000 })

    const calls: string[] = []
    const scheduler = createRefreshScheduler({
      intervalMs: 10,
      queue: q,
      now: () => 60_000,
      getTasks: () => [
        {
          key: "a",
          expiresAt: 50_000,
          refresh: async () => {
            calls.push("a")
          }
        }
      ]
    })

    try {
      scheduler.start()
      await vi.advanceTimersByTimeAsync(10)
      scheduler.stop()
      expect(calls).toEqual(["a"])
    } finally {
      scheduler.stop()
      vi.useRealTimers()
    }
  })

  it("prevents concurrent ticks", async () => {
    vi.useFakeTimers()
    const q = new ProactiveRefreshQueue({ bufferMs: 10_000 })
    q.enqueue({ key: "a", expiresAt: 50_000 })

    const calls: string[] = []
    let unblock: (() => void) | undefined
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve
    })

    const scheduler = createRefreshScheduler({
      intervalMs: 1,
      queue: q,
      now: () => 60_000,
      getTasks: () => [
        {
          key: "a",
          expiresAt: 50_000,
          refresh: async () => {
            calls.push("a")
            await blocked
          }
        }
      ]
    })

    try {
      scheduler.start()
      await vi.advanceTimersByTimeAsync(20)
      expect(calls).toEqual(["a"])
      unblock?.()
    } finally {
      scheduler.stop()
      vi.useRealTimers()
    }
  })

  it("start/stop are idempotent", async () => {
    vi.useFakeTimers()
    const q = new ProactiveRefreshQueue({ bufferMs: 10_000 })
    q.enqueue({ key: "a", expiresAt: 50_000 })

    const calls: string[] = []
    const scheduler = createRefreshScheduler({
      intervalMs: 10,
      queue: q,
      now: () => 60_000,
      getTasks: () => [
        {
          key: "a",
          expiresAt: 50_000,
          refresh: async () => {
            calls.push("a")
          }
        }
      ]
    })

    try {
      scheduler.start()
      scheduler.start()
      await vi.advanceTimersByTimeAsync(10)
      scheduler.stop()
      scheduler.stop()
      expect(calls).toEqual(["a"])
    } finally {
      scheduler.stop()
      vi.useRealTimers()
    }
  })

  it("continues after refresh errors", async () => {
    vi.useFakeTimers()
    const q = new ProactiveRefreshQueue({ bufferMs: 10_000 })
    q.enqueue({ key: "a", expiresAt: 50_000 })
    q.enqueue({ key: "b", expiresAt: 50_001 })

    const calls: string[] = []
    const scheduler = createRefreshScheduler({
      intervalMs: 10,
      queue: q,
      now: () => 60_000,
      getTasks: () => [
        {
          key: "a",
          expiresAt: 50_000,
          refresh: async () => {
            throw new Error("boom")
          }
        },
        {
          key: "b",
          expiresAt: 50_001,
          refresh: async () => {
            calls.push("b")
          }
        }
      ]
    })

    try {
      scheduler.start()
      await vi.advanceTimersByTimeAsync(10)
      scheduler.stop()
      expect(calls).toEqual(["b"])
    } finally {
      scheduler.stop()
      vi.useRealTimers()
    }
  })
})
