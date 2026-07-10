import type { Hooks } from "@opencode-ai/plugin"

export function composePluginDispose(input: {
  hooks: Hooks
  scheduler?: { stop: () => void }
  clearScheduler: () => void
}): void {
  const downstreamDispose = input.hooks.dispose
  input.hooks.dispose = async () => {
    let schedulerError: unknown
    try {
      input.scheduler?.stop()
    } catch (error) {
      schedulerError = error
    } finally {
      input.clearScheduler()
    }

    try {
      await downstreamDispose?.()
    } catch (error) {
      if (schedulerError !== undefined) {
        throw new AggregateError([schedulerError, error], "Plugin disposal failed")
      }
      throw error
    }

    if (schedulerError !== undefined) {
      throw schedulerError
    }
  }
}
