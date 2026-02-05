export type PluginConfig = {
  debug?: boolean
  proactiveRefresh?: boolean
  proactiveRefreshBufferMs?: number
  quietMode?: boolean
}

function parseEnvBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  if (value === "1" || value === "true") return true
  if (value === "0" || value === "false") return false
  return undefined
}

function parseEnvNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

export function resolveConfig(input: {
  env: Record<string, string | undefined>
  file?: Partial<PluginConfig>
}): PluginConfig {
  const env = input.env
  const file = input.file ?? {}

  const envDebug =
    env.CODEX_AUTH_DEBUG === "1" ||
    env.OPENCODE_OPENAI_AUTH_DEBUG === "1" ||
    env.DEBUG_CODEX_PLUGIN === "1"

  const proactiveRefresh =
    parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH) ?? file.proactiveRefresh
  const proactiveRefreshBufferMs =
    parseEnvNumber(env.OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH_BUFFER_MS) ??
    file.proactiveRefreshBufferMs

  return {
    ...file,
    debug: envDebug || file.debug === true,
    proactiveRefresh,
    proactiveRefreshBufferMs
  }
}

export function getDebugEnabled(cfg: PluginConfig): boolean {
  return cfg.debug === true
}

export function getQuietMode(cfg: PluginConfig): boolean {
  return cfg.quietMode === true
}

export function getProactiveRefreshEnabled(cfg: PluginConfig): boolean {
  return cfg.proactiveRefresh === true
}

export function getProactiveRefreshBufferMs(cfg: PluginConfig): number {
  return typeof cfg.proactiveRefreshBufferMs === "number" && Number.isFinite(cfg.proactiveRefreshBufferMs)
    ? Math.max(0, Math.floor(cfg.proactiveRefreshBufferMs))
    : 60_000
}
