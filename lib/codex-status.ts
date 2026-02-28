import type { CodexRateLimitSnapshot, CodexLimit } from "./types.js"

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
    const remaining = num(
      input.headers["x-ratelimit-remaining-requests"] ??
        input.headers["x-ratelimit-requests-remaining"] ??
        input.headers["x-ratelimit-remaining"] ??
        input.headers["ratelimit-remaining"]
    )
    const limit = num(
      input.headers["x-ratelimit-limit-requests"] ??
        input.headers["x-ratelimit-requests-limit"] ??
        input.headers["x-ratelimit-limit"] ??
        input.headers["ratelimit-limit"]
    )
    const resetAt = parseResetMs(
      input.headers["x-ratelimit-reset-requests"] ??
        input.headers["x-ratelimit-requests-reset"] ??
        input.headers["x-ratelimit-reset"] ??
        input.headers["ratelimit-reset"],
      input.now
    )

    const limits: CodexLimit[] = []
    if (remaining !== undefined && limit !== undefined && limit > 0) {
      limits.push({
        name: "requests",
        leftPct: Math.max(0, Math.min(100, Math.round((remaining / limit) * 100))),
        resetsAt: resetAt
      })
    }

    const tokenRemaining = num(
      input.headers["x-ratelimit-remaining-tokens"] ??
        input.headers["x-ratelimit-tokens-remaining"] ??
        input.headers["ratelimit-remaining-tokens"]
    )
    const tokenLimit = num(
      input.headers["x-ratelimit-limit-tokens"] ??
        input.headers["x-ratelimit-tokens-limit"] ??
        input.headers["ratelimit-limit-tokens"]
    )
    const tokenResetAt = parseResetMs(
      input.headers["x-ratelimit-reset-tokens"] ??
        input.headers["x-ratelimit-tokens-reset"] ??
        input.headers["ratelimit-reset-tokens"],
      input.now
    )
    if (tokenRemaining !== undefined && tokenLimit !== undefined && tokenLimit > 0) {
      limits.push({
        name: "tokens",
        leftPct: Math.max(0, Math.min(100, Math.round((tokenRemaining / tokenLimit) * 100))),
        resetsAt: tokenResetAt
      })
    }

    return { updatedAt: input.now, modelFamily: input.modelFamily, limits }
  }
}
