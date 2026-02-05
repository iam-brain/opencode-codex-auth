export type HeaderMap = Record<string, string | undefined>

export function parseRetryAfterMs(headers: HeaderMap, nowMs: number): number | undefined {
  const raw = headers["retry-after"] ?? headers["Retry-After"]
  if (!raw) return undefined

  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1000)

  const dateMs = Date.parse(raw)
  if (!Number.isFinite(dateMs)) return undefined

  const delta = dateMs - nowMs
  return delta >= 0 ? delta : 0
}
