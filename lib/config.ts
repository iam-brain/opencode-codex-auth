export type PluginConfig = {
  proactiveRefresh?: boolean
  proactiveRefreshBufferMs?: number
}

export function getProactiveRefreshEnabled(cfg: PluginConfig): boolean {
  return cfg.proactiveRefresh === true
}

export function getProactiveRefreshBufferMs(cfg: PluginConfig): number {
  return typeof cfg.proactiveRefreshBufferMs === "number" && Number.isFinite(cfg.proactiveRefreshBufferMs)
    ? Math.max(0, Math.floor(cfg.proactiveRefreshBufferMs))
    : 60_000
}
