export type Logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => void
  info: (msg: string, meta?: Record<string, unknown>) => void
  warn: (msg: string, meta?: Record<string, unknown>) => void
  error: (msg: string, meta?: Record<string, unknown>) => void
}

function safeJson(meta?: Record<string, unknown>) {
  if (!meta) return ""
  try {
    // Avoid accidentally stringifying tokens: keep meta shallow & caller-controlled.
    return " " + JSON.stringify(meta)
  } catch {
    return ""
  }
}

export function createLogger(input: { debug: boolean; sink?: (line: string) => void }): Logger {
  const sink = input.sink ?? ((line) => console.error(line))

  function emit(level: string, msg: string, meta?: Record<string, unknown>) {
    sink(`[${level}] ${msg}${safeJson(meta)}`)
  }

  return {
    debug(msg, meta) { if (input.debug) emit("debug", msg, meta) },
    info(msg, meta) { emit("info", msg, meta) },
    warn(msg, meta) { emit("warn", msg, meta) },
    error(msg, meta) { emit("error", msg, meta) }
  }
}
