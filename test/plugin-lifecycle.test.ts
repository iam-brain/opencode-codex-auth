import type { Hooks } from "@opencode-ai/plugin"
import { describe, expect, it, vi } from "vitest"

import { composePluginDispose } from "../lib/plugin-lifecycle"

describe("plugin lifecycle", () => {
  it("stops the scheduler, clears ownership, and composes downstream cleanup", async () => {
    const stop = vi.fn()
    const clearScheduler = vi.fn()
    const downstreamDispose = vi.fn(async () => {})
    const hooks = { dispose: downstreamDispose } as Hooks

    composePluginDispose({ hooks, scheduler: { stop }, clearScheduler })
    await hooks.dispose?.()

    expect(stop).toHaveBeenCalledOnce()
    expect(clearScheduler).toHaveBeenCalledOnce()
    expect(downstreamDispose).toHaveBeenCalledOnce()
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(downstreamDispose.mock.invocationCallOrder[0] ?? 0)
  })

  it("still installs cleanup when proactive refresh is disabled", async () => {
    const clearScheduler = vi.fn()
    const hooks = {} as Hooks

    composePluginDispose({ hooks, clearScheduler })
    await hooks.dispose?.()

    expect(clearScheduler).toHaveBeenCalledOnce()
  })

  it("runs ownership and downstream cleanup even when scheduler stop throws", async () => {
    const stopError = new Error("stop failed")
    const clearScheduler = vi.fn()
    const downstreamDispose = vi.fn(async () => {})
    const hooks = { dispose: downstreamDispose } as Hooks

    composePluginDispose({
      hooks,
      scheduler: {
        stop: () => {
          throw stopError
        }
      },
      clearScheduler
    })

    await expect(hooks.dispose?.()).rejects.toBe(stopError)
    expect(clearScheduler).toHaveBeenCalledOnce()
    expect(downstreamDispose).toHaveBeenCalledOnce()
  })

  it("does not let stale-instance cleanup clear newer scheduler ownership", async () => {
    const firstStop = vi.fn()
    const secondStop = vi.fn()
    const firstScheduler = { stop: firstStop }
    const secondScheduler = { stop: secondStop }
    let scheduler: { stop: () => void } | undefined = secondScheduler
    const hooks = {} as Hooks

    composePluginDispose({
      hooks,
      scheduler: firstScheduler,
      clearScheduler: () => {
        if (scheduler === firstScheduler) scheduler = undefined
      }
    })
    await hooks.dispose?.()

    expect(firstStop).toHaveBeenCalledOnce()
    expect(secondStop).not.toHaveBeenCalled()
    expect(scheduler).toBe(secondScheduler)
  })
})
