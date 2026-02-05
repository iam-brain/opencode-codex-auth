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
