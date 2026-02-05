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
