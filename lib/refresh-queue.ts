export type RefreshTask = {
  key: string
  expiresAt: number
}

export class ProactiveRefreshQueue {
  private tasks = new Map<string, RefreshTask>()
  private bufferMs: number

  constructor(input: { bufferMs: number }) {
    this.bufferMs = Math.max(0, Math.floor(input.bufferMs))
  }

  enqueue(task: RefreshTask) {
    this.tasks.set(task.key, task)
  }

  remove(key: string) {
    this.tasks.delete(key)
  }

  due(nowMs: number): RefreshTask[] {
    const due: RefreshTask[] = []
    for (const t of this.tasks.values()) {
      if (t.expiresAt <= nowMs + this.bufferMs) due.push(t)
    }
    due.sort((a, b) => a.expiresAt - b.expiresAt)
    return due
  }
}

export type RefreshTaskRunner = {
  key: string
  expiresAt: number
  refresh: () => Promise<void>
}

export type RefreshScheduler = {
  start: () => void
  stop: () => void
}

export function createRefreshScheduler(input: {
  intervalMs: number
  queue: ProactiveRefreshQueue
  now: () => number
  getTasks: () => RefreshTaskRunner[]
}): RefreshScheduler {
  const intervalMs = Math.max(1, Math.floor(input.intervalMs))
  let timer: NodeJS.Timeout | undefined
  let running = false

  async function tick() {
    if (running) return
    running = true
    try {
      const now = input.now()
      const due = input.queue.due(now)
      if (due.length === 0) return

      const runners = input.getTasks()
      for (const task of due) {
        input.queue.remove(task.key)
        const runner = runners.find((r) => r.key === task.key)
        if (!runner) continue
        try {
          await runner.refresh()
        } catch (error) {
          if (error instanceof Error) {
            // best-effort background work
          }
          // best-effort background work
        }
      }
    } finally {
      running = false
    }
  }

  return {
    start() {
      if (timer) return
      timer = setInterval(() => {
        tick().catch((error) => {
          if (error instanceof Error) {
            // best-effort background scheduler
          }
        })
      }, intervalMs)
    },
    stop() {
      if (!timer) return
      clearInterval(timer)
      timer = undefined
    }
  }
}
