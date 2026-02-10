export type PluginFatalErrorInput = {
  message: string
  status?: number
  type?: string
  param?: string
}

export class PluginFatalError extends Error {
  readonly status: number
  readonly type: string
  readonly param?: string

  constructor(input: PluginFatalErrorInput) {
    super(input.message)
    this.name = "PluginFatalError"
    this.status = input.status ?? 400
    this.type = input.type ?? "hard_stop"
    this.param = input.param
  }
}

export function isPluginFatalError(value: unknown): value is PluginFatalError {
  return value instanceof PluginFatalError
}

export function createSyntheticErrorResponse(
  message: string,
  status = 400,
  type = "hard_stop",
  param?: string
): Response {
  const errorPayload: { error: { message: string; type: string; param?: string } } = {
    error: {
      message,
      type
    }
  }

  if (param) {
    errorPayload.error.param = param
  }

  return new Response(JSON.stringify(errorPayload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  })
}

export function toSyntheticErrorResponse(error: PluginFatalError): Response {
  return createSyntheticErrorResponse(error.message, error.status, error.type, error.param)
}

export function formatWaitTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}
