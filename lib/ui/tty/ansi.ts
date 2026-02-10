export const ANSI = {
  hide: "\x1b[?25l",
  show: "\x1b[?25h",
  up: (n = 1) => `\x1b[${n}A`,
  clearLine: "\x1b[2K",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m"
} as const

export type KeyAction = "up" | "down" | "enter" | "escape" | "escape-start" | null

export function parseKey(data: Buffer): KeyAction {
  const s = data.toString()
  if (s === "\x1b[A" || s === "\x1bOA") return "up"
  if (s === "\x1b[B" || s === "\x1bOB") return "down"
  if (s === "\r" || s === "\n") return "enter"
  if (s === "\x03") return "escape"
  if (s === "\x1b") return "escape-start"
  return null
}

export function isTTY(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout
): boolean {
  return Boolean(input.isTTY && output.isTTY)
}

export function shouldUseColor(): boolean {
  const noColor = process.env.NO_COLOR
  if (noColor && noColor !== "0") return false
  return true
}
