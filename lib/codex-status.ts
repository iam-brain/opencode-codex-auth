import type { CodexRateLimitSnapshot, CodexLimit } from "./types"

export type HeaderMap = Record<string, string | undefined>

function num(v?: string): number | undefined {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function parseResetMs(raw: string | undefined, now: number): number | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined

  if (/^\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10)
    if (!Number.isFinite(parsed)) return undefined
    if (parsed >= 1_000_000_000_000) return parsed
    if (parsed <= 86_400) return now + parsed * 1000
    return parsed * 1000
  }

  if (/^\d+(?:\.\d+)?s$/i.test(trimmed)) {
    const parsed = Number.parseFloat(trimmed.slice(0, -1))
    return Number.isFinite(parsed) ? now + Math.round(parsed * 1000) : undefined
  }

  if (/^\d+(?:\.\d+)?ms$/i.test(trimmed)) {
    const parsed = Number.parseFloat(trimmed.slice(0, -2))
    return Number.isFinite(parsed) ? now + Math.round(parsed) : undefined
  }

  return undefined
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
    const resetAt = parseResetMs(input.headers["x-ratelimit-reset-requests"], input.now)

    const limits: CodexLimit[] = []
    if (remaining !== undefined && limit !== undefined && limit > 0) {
      limits.push({
        name: "requests",
        leftPct: Math.max(0, Math.min(100, Math.round((remaining / limit) * 100))),
        resetsAt: resetAt
      })
    }

    return { updatedAt: input.now, modelFamily: input.modelFamily, limits }
  }
}
