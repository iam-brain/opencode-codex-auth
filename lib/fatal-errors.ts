export type PluginFatalErrorInput = {
  message: string
  status?: number
  type?: string
  param?: string
  source?: string
  hint?: string
}

export class PluginFatalError extends Error {
  readonly status: number
  readonly type: string
  readonly param?: string
  readonly source?: string
  readonly hint?: string

  constructor(input: PluginFatalErrorInput) {
    super(input.message)
    this.name = "PluginFatalError"
    this.status = input.status ?? 400
    this.type = input.type ?? "hard_stop"
    this.param = input.param
    this.source = input.source
    this.hint = input.hint
  }
}

export function isPluginFatalError(value: unknown): value is PluginFatalError {
  return value instanceof PluginFatalError
}

export function createSyntheticErrorResponse(
  message: string,
  status = 400,
  type = "hard_stop",
  param?: string,
  source?: string,
  hint?: string
): Response {
  const errorPayload: { error: { message: string; type: string; param?: string; source?: string; hint?: string } } = {
    error: {
      message,
      type
    }
  }

  if (param) {
    errorPayload.error.param = param
  }
  if (source) {
    errorPayload.error.source = source
  }
  if (hint) {
    errorPayload.error.hint = hint
  }

  return new Response(JSON.stringify(errorPayload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  })
}

export function toSyntheticErrorResponse(error: PluginFatalError): Response {
  return createSyntheticErrorResponse(error.message, error.status, error.type, error.param, error.source, error.hint)
}

export function formatWaitTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}
