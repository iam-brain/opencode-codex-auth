export type HeaderMap = Record<string, string | undefined>

export function parseRetryAfterMs(headers: HeaderMap, nowMs: number): number | undefined {
  let raw: string | undefined
  for (const key in headers) {
    if (key.toLowerCase() === "retry-after") {
      raw = headers[key]
      break
    }
  }
  if (raw === undefined) return undefined

  const trimmed = raw.trim()
  if (!trimmed) return undefined

  if (/^[0-9]+$/.test(trimmed)) {
    return parseInt(trimmed, 10) * 1000
  }

  if (!isNaN(Number(trimmed))) {
    return undefined
  }

  const dateMs = Date.parse(trimmed)
  if (!Number.isFinite(dateMs)) return undefined

  return Math.max(0, dateMs - nowMs)
}

export function computeBackoffMs(input: {
  attempt: number
  baseMs: number
  maxMs: number
  jitterMaxMs: number
}): number {
  const attempt = Math.max(0, Math.floor(input.attempt))
  const exp = input.baseMs * Math.pow(2, attempt)
  const capped = Math.min(exp, input.maxMs)
  const jitter = input.jitterMaxMs > 0 ? Math.floor(Math.random() * (input.jitterMaxMs + 1)) : 0
  return capped + jitter
}
