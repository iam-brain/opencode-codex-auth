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

export interface MenuItem<T = string> {
  label: string
  value: T
  hint?: string
  disabled?: boolean
  separator?: boolean
  color?: "red" | "green" | "yellow" | "cyan"
}

export interface SelectOptions {
  message: string
  subtitle?: string
  input?: NodeJS.ReadStream
  output?: NodeJS.WriteStream
  useColor?: boolean
}

export type ConfirmOptions = {
  input?: NodeJS.ReadStream
  output?: NodeJS.WriteStream
  useColor?: boolean
}

const ESCAPE_TIMEOUT_MS = 50
const ANSI_PATTERN = /^\x1b\[[0-9;?]*[A-Za-z]/

function getColorCode(color: MenuItem["color"]): string {
  switch (color) {
    case "red":
      return ANSI.red
    case "green":
      return ANSI.green
    case "yellow":
      return ANSI.yellow
    case "cyan":
      return ANSI.cyan
    default:
      return ""
  }
}

function visibleLength(text: string): number {
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").length
}

function truncateAnsi(text: string, maxVisible: number): string {
  if (maxVisible <= 0) return ""
  if (visibleLength(text) <= maxVisible) return text
  const ellipsis = "..."
  const limit = Math.max(1, maxVisible - ellipsis.length)
  let visible = 0
  let i = 0
  let out = ""
  let hasAnsi = false

  while (i < text.length && visible < limit) {
    if (text[i] === "\x1b") {
      const match = text.slice(i).match(ANSI_PATTERN)
      if (match) {
        out += match[0]
        i += match[0].length
        hasAnsi = true
        continue
      }
    }
    out += text[i]
    visible += 1
    i += 1
  }

  out += ellipsis
  if (hasAnsi) out += ANSI.reset
  return out
}

function formatItemLabel(item: MenuItem<unknown>, selected: boolean, useColor: boolean, maxWidth: number): string {
  const colorCode = useColor ? getColorCode(item.color) : ""
  let labelText: string

  if (item.disabled) {
    labelText = useColor ? `${ANSI.dim}${item.label} (unavailable)${ANSI.reset}` : `${item.label} (unavailable)`
  } else if (selected) {
    labelText = colorCode ? `${colorCode}${item.label}${ANSI.reset}` : item.label
    if (item.hint) {
      labelText += useColor ? ` ${ANSI.dim}${item.hint}${ANSI.reset}` : ` ${item.hint}`
    }
  } else {
    labelText = useColor
      ? colorCode
        ? `${ANSI.dim}${colorCode}${item.label}${ANSI.reset}`
        : `${ANSI.dim}${item.label}${ANSI.reset}`
      : item.label
    if (item.hint) {
      labelText += useColor ? ` ${ANSI.dim}${item.hint}${ANSI.reset}` : ` ${item.hint}`
    }
  }

  return truncateAnsi(labelText, maxWidth)
}

export function parseKey(data: Buffer): KeyAction {
  const s = data.toString()
  if (s === "\x1b[A" || s === "\x1bOA") return "up"
  if (s === "\x1b[B" || s === "\x1bOB") return "down"
  if (s === "\r" || s === "\n") return "enter"
  if (s === "\x03") return "escape"
  if (s === "\x1b") return "escape-start"
  return null
}

export function isTTY(input: NodeJS.ReadStream = process.stdin, output: NodeJS.WriteStream = process.stdout): boolean {
  return Boolean(input.isTTY && output.isTTY)
}

export function shouldUseColor(): boolean {
  const noColor = process.env.NO_COLOR
  if (noColor && noColor !== "0") return false
  return true
}

export async function select<T>(items: MenuItem<T>[], options: SelectOptions): Promise<T | null> {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  const useColor = options.useColor ?? shouldUseColor()

  if (!isTTY(input, output)) return null
  if (items.length === 0) return null

  const enabledItems = items.filter((item) => !item.disabled && !item.separator)
  if (enabledItems.length === 0) return null
  if (enabledItems.length === 1) return enabledItems[0]?.value ?? null

  const { message, subtitle } = options
  let cursor = items.findIndex((item) => !item.disabled && !item.separator)
  if (cursor === -1) cursor = 0
  let escapeTimeout: ReturnType<typeof setTimeout> | null = null
  let isCleanedUp = false
  let isFirstRender = true

  const getTotalLines = (): number => {
    const subtitleLines = subtitle ? 3 : 0
    return 1 + subtitleLines + items.length + 1 + 1
  }

  const render = () => {
    const totalLines = getTotalLines()
    const columns = output.columns ?? 80
    const contentWidth = Math.max(10, columns - 6)

    if (!isFirstRender) {
      output.write(ANSI.up(totalLines) + "\r")
    }
    isFirstRender = false

    output.write(`${ANSI.clearLine}${useColor ? ANSI.dim : ""}┌  ${useColor ? ANSI.reset : ""}${message}\n`)

    if (subtitle) {
      output.write(`${ANSI.clearLine}${useColor ? ANSI.dim : ""}│${useColor ? ANSI.reset : ""}\n`)
      output.write(`${ANSI.clearLine}${useColor ? ANSI.cyan : ""}◆${useColor ? ANSI.reset : ""}  ${subtitle}\n`)
      output.write(`${ANSI.clearLine}\n`)
    }

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      if (!item) continue

      if (item.separator) {
        output.write(`${ANSI.clearLine}${useColor ? ANSI.dim : ""}│${useColor ? ANSI.reset : ""}\n`)
        continue
      }

      const isSelected = i === cursor
      const labelText = formatItemLabel(item, isSelected, useColor, contentWidth)
      if (isSelected) {
        output.write(
          `${ANSI.clearLine}${useColor ? ANSI.cyan : ""}│${useColor ? ANSI.reset : ""}  ${useColor ? ANSI.green : ""}●${useColor ? ANSI.reset : ""} ${labelText}\n`
        )
      } else {
        output.write(
          `${ANSI.clearLine}${useColor ? ANSI.cyan : ""}│${useColor ? ANSI.reset : ""}  ${useColor ? ANSI.dim : ""}○${useColor ? ANSI.reset : ""} ${labelText}\n`
        )
      }
    }

    output.write(
      `${ANSI.clearLine}${useColor ? ANSI.cyan : ""}│${useColor ? ANSI.reset : ""}  ${useColor ? ANSI.dim : ""}↑/↓ to select • Enter: confirm${useColor ? ANSI.reset : ""}\n`
    )
    output.write(`${ANSI.clearLine}${useColor ? ANSI.cyan : ""}└${useColor ? ANSI.reset : ""}\n`)
  }

  return new Promise((resolve) => {
    const wasRaw = typeof input.isRaw === "boolean" ? input.isRaw : false

    const cleanup = () => {
      if (isCleanedUp) return
      isCleanedUp = true

      if (escapeTimeout) {
        clearTimeout(escapeTimeout)
        escapeTimeout = null
      }

      try {
        input.removeListener("data", onKey)
        if (typeof input.setRawMode === "function") {
          input.setRawMode(wasRaw)
        }
        input.pause()
        output.write(ANSI.show)
      } catch (error) {
        if (error instanceof Error) {
          // best effort cleanup
        }
      }

      process.removeListener("SIGINT", onSignal)
      process.removeListener("SIGTERM", onSignal)
    }

    const onSignal = () => {
      cleanup()
      resolve(null)
    }

    const finishWithValue = (value: T | null) => {
      cleanup()
      resolve(value)
    }

    const findNextSelectable = (from: number, direction: 1 | -1): number => {
      if (items.length === 0) return from
      let next = from
      do {
        next = (next + direction + items.length) % items.length
      } while (items[next]?.disabled || items[next]?.separator)
      return next
    }

    const onKey = (data: Buffer) => {
      if (escapeTimeout) {
        clearTimeout(escapeTimeout)
        escapeTimeout = null
      }

      const action = parseKey(data)
      switch (action) {
        case "up":
          cursor = findNextSelectable(cursor, -1)
          render()
          return
        case "down":
          cursor = findNextSelectable(cursor, 1)
          render()
          return
        case "enter":
          finishWithValue(items[cursor]?.value ?? null)
          return
        case "escape":
          finishWithValue(null)
          return
        case "escape-start":
          escapeTimeout = setTimeout(() => {
            finishWithValue(null)
          }, ESCAPE_TIMEOUT_MS)
          return
        default:
          return
      }
    }

    process.once("SIGINT", onSignal)
    process.once("SIGTERM", onSignal)

    try {
      if (typeof input.setRawMode === "function") {
        input.setRawMode(true)
      }
      input.resume()
      output.write(ANSI.hide)
      render()
      input.on("data", onKey)
    } catch (error) {
      if (error instanceof Error) {
        // fall through to null result on non-interactive terminals
      }
      finishWithValue(null)
    }
  })
}

export async function confirm(message: string, defaultYes = false, options: ConfirmOptions = {}): Promise<boolean> {
  const items = defaultYes
    ? [
        { label: "Yes", value: true },
        { label: "No", value: false }
      ]
    : [
        { label: "No", value: false },
        { label: "Yes", value: true }
      ]

  const result = await select(items, {
    message,
    input: options.input,
    output: options.output,
    useColor: options.useColor
  })
  return result ?? false
}
