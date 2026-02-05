import type { CodexRateLimitSnapshot, CodexLimit } from "./types"

export type HeaderMap = Record<string, string | undefined>

function num(v?: string): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

export class CodexStatus {
  private snapshots = new Map<string, CodexRateLimitSnapshot>()

  updateSnapshot(identityKey: string, snap: CodexRateLimitSnapshot): void {
    this.snapshots.set(identityKey, snap)
  }

  getSnapshot(identityKey: string): CodexRateLimitSnapshot | undefined {
    return this.snapshots.get(identityKey)
  }

  getAllSnapshots(): Record<string, CodexRateLimitSnapshot> {
    return Object.fromEntries(this.snapshots.entries())
  }

  parseFromHeaders(input: { now: number; modelFamily: string; headers: HeaderMap }): CodexRateLimitSnapshot {
    const remaining = num(input.headers["x-ratelimit-remaining-requests"])
    const limit = num(input.headers["x-ratelimit-limit-requests"])
    const resetSeconds = num(input.headers["x-ratelimit-reset-requests"])

    const limits: CodexLimit[] = []
    if (remaining !== undefined && limit !== undefined && limit > 0) {
      limits.push({
        name: "requests",
        leftPct: Math.max(0, Math.min(100, Math.round((remaining / limit) * 100))),
        resetsAt: resetSeconds !== undefined ? resetSeconds * 1000 : undefined
      })
    }

    return { updatedAt: input.now, modelFamily: input.modelFamily, limits }
  }
}
