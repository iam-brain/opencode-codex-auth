const MAX_TOAST_MESSAGE_LENGTH = 160
const MAX_TOKEN_LENGTH = 48
const MAX_PATH_LENGTH = 48

function stripBracketedSegments(message: string): string {
  return message
    .replace(/\s*\[[^\]]*\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

function truncateMiddle(value: string, maxLength: number): string {
  if (maxLength <= 0) return ""
  if (value.length <= maxLength) return value
  if (maxLength === 1) return "…"
  const head = Math.max(1, Math.floor(maxLength * 0.4))
  const tail = Math.max(0, maxLength - head - 1)
  if (tail === 0) return `${value.slice(0, head)}…`
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

function truncatePath(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input
  const parts = input.split(/[\\/]/)
  const last = parts[parts.length - 1] ?? input
  if (last.length + 2 >= maxLength) {
    return truncateMiddle(last, maxLength)
  }
  const headLen = Math.max(1, maxLength - last.length - 1)
  return `${input.slice(0, headLen)}…${last}`
}

function normalizeWhitespace(message: string): string {
  return message.replace(/\s+/g, " ").trim()
}

function truncateToken(token: string): string {
  if (token.length <= MAX_TOKEN_LENGTH) return token
  if (token.includes("/") || token.includes("\\")) {
    return truncatePath(token, MAX_PATH_LENGTH)
  }
  return truncateMiddle(token, MAX_TOKEN_LENGTH)
}

export function formatToastMessage(message: string): string {
  const normalized = normalizeWhitespace(stripBracketedSegments(message))
  const tokens = normalized.split(" ")
  const formatted = tokens.map((token) => truncateToken(token)).join(" ")
  if (formatted.length <= MAX_TOAST_MESSAGE_LENGTH) return formatted
  return truncateMiddle(formatted, MAX_TOAST_MESSAGE_LENGTH)
}
