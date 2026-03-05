import type { RotationStrategy } from "../types.js"
import {
  buildResolvedBehaviorSettings,
  normalizePersonalityOption,
  normalizeServiceTierOption,
  normalizeVerbosityOption,
  parseEnvBoolean,
  parseEnvNumber,
  parsePromptCacheKeyStrategy,
  parseRotationStrategy,
  parseRuntimeMode,
  parseSpoofMode
} from "./parse.js"
import type {
  BehaviorSettings,
  CodexSpoofMode,
  PersonalityOption,
  PluginConfig,
  PluginRuntimeMode,
  PromptCacheKeyStrategy
} from "./types.js"

export function resolveConfig(input: {
  env: Record<string, string | undefined>
  file?: Partial<PluginConfig>
}): PluginConfig {
  const env = input.env
  const file = input.file ?? {}
  const fileBehavior = file.behaviorSettings

  const envDebug = env.OPENCODE_OPENAI_MULTI_DEBUG === "1" || env.DEBUG_CODEX_PLUGIN === "1"

  const proactiveRefresh = parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH) ?? file.proactiveRefresh
  const proactiveRefreshBufferMs =
    parseEnvNumber(env.OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH_BUFFER_MS) ?? file.proactiveRefreshBufferMs
  const quietMode = parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_QUIET) ?? file.quietMode ?? file.quiet
  const pidOffsetEnabled = parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_PID_OFFSET) ?? file.pidOffsetEnabled
  const rotationStrategy = parseRotationStrategy(env.OPENCODE_OPENAI_MULTI_ROTATION_STRATEGY) ?? file.rotationStrategy
  const promptCacheKeyStrategy =
    parsePromptCacheKeyStrategy(env.OPENCODE_OPENAI_MULTI_PROMPT_CACHE_KEY_STRATEGY) ?? file.promptCacheKeyStrategy

  const envPersonality = normalizePersonalityOption(env.OPENCODE_OPENAI_MULTI_PERSONALITY)
  const envThinkingSummaries = parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_THINKING_SUMMARIES)
  const envVerbosityEnabled = parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_VERBOSITY_ENABLED)
  const envVerbosity = normalizeVerbosityOption(env.OPENCODE_OPENAI_MULTI_VERBOSITY)
  const envServiceTier = normalizeServiceTierOption(env.OPENCODE_OPENAI_MULTI_SERVICE_TIER)
  const spoofModeFromEnv = parseSpoofMode(env.OPENCODE_OPENAI_MULTI_SPOOF_MODE)
  const modeFromEnv = parseRuntimeMode(env.OPENCODE_OPENAI_MULTI_MODE)
  const modeFromLegacySpoofInput =
    spoofModeFromEnv === "codex"
      ? "codex"
      : spoofModeFromEnv === "native"
        ? "native"
        : file.spoofMode === "codex"
          ? "codex"
          : file.spoofMode === "native"
            ? "native"
            : undefined
  const mode = modeFromEnv ?? file.mode ?? modeFromLegacySpoofInput ?? "native"

  const resolvedBehaviorSettings = buildResolvedBehaviorSettings({
    fileBehavior,
    envPersonality,
    envThinkingSummaries,
    envVerbosityEnabled,
    envVerbosity,
    envServiceTier
  })

  const personality = envPersonality ?? resolvedBehaviorSettings?.global?.personality

  // Runtime mode is canonical; spoofMode is always derived for compatibility output.
  const spoofMode = mode === "native" ? "native" : "codex"
  const compatInputSanitizer =
    parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_COMPAT_INPUT_SANITIZER) ?? file.compatInputSanitizer
  const remapDeveloperMessagesToUser =
    parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_REMAP_DEVELOPER_MESSAGES_TO_USER) ?? file.remapDeveloperMessagesToUser
  const codexCompactionOverride =
    parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_CODEX_COMPACTION_OVERRIDE) ?? file.codexCompactionOverride
  const headerSnapshots = parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS) ?? file.headerSnapshots
  const headerSnapshotBodies =
    parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOT_BODIES) ?? file.headerSnapshotBodies
  const headerTransformDebug =
    parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_HEADER_TRANSFORM_DEBUG) ?? file.headerTransformDebug
  const collaborationProfileEnabled =
    parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_COLLABORATION_PROFILE) ??
    file.collaborationProfileEnabled ??
    file.collaborationProfile
  const orchestratorSubagentsEnabled =
    parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_ORCHESTRATOR_SUBAGENTS) ??
    file.orchestratorSubagentsEnabled ??
    file.orchestratorSubagents

  return {
    ...file,
    debug: envDebug || file.debug === true,
    proactiveRefresh,
    proactiveRefreshBufferMs,
    quietMode,
    pidOffsetEnabled,
    personality,
    mode,
    rotationStrategy,
    promptCacheKeyStrategy,
    spoofMode,
    compatInputSanitizer,
    remapDeveloperMessagesToUser,
    codexCompactionOverride,
    headerSnapshots,
    headerSnapshotBodies,
    headerTransformDebug,
    collaborationProfileEnabled,
    orchestratorSubagentsEnabled,
    behaviorSettings: resolvedBehaviorSettings
  }
}

export function getDebugEnabled(cfg: PluginConfig): boolean {
  return cfg.debug === true
}

export function getQuietMode(cfg: PluginConfig): boolean {
  return cfg.quietMode === true
}

export function getPidOffsetEnabled(cfg: PluginConfig): boolean {
  return cfg.pidOffsetEnabled === true
}

export function getProactiveRefreshEnabled(cfg: PluginConfig): boolean {
  return cfg.proactiveRefresh === true
}

export function getProactiveRefreshBufferMs(cfg: PluginConfig): number {
  return typeof cfg.proactiveRefreshBufferMs === "number" && Number.isFinite(cfg.proactiveRefreshBufferMs)
    ? Math.max(0, Math.floor(cfg.proactiveRefreshBufferMs))
    : 60_000
}

export function getPersonality(cfg: PluginConfig): PersonalityOption | undefined {
  return cfg.personality
}

export function getSpoofMode(cfg: PluginConfig): CodexSpoofMode {
  return cfg.spoofMode === "codex" ? "codex" : "native"
}

export function getMode(cfg: PluginConfig): PluginRuntimeMode {
  if (cfg.mode === "native" || cfg.mode === "codex") return cfg.mode
  return getSpoofMode(cfg) === "codex" ? "codex" : "native"
}

export function getRotationStrategy(cfg: PluginConfig): RotationStrategy {
  return cfg.rotationStrategy === "hybrid" || cfg.rotationStrategy === "round_robin" ? cfg.rotationStrategy : "sticky"
}

export function getPromptCacheKeyStrategy(cfg: PluginConfig): PromptCacheKeyStrategy {
  return cfg.promptCacheKeyStrategy === "project" ? "project" : "default"
}

export function getCompatInputSanitizerEnabled(cfg: PluginConfig): boolean {
  return cfg.compatInputSanitizer === true
}

export function getRemapDeveloperMessagesToUserEnabled(cfg: PluginConfig): boolean {
  if (getMode(cfg) !== "codex") return false
  return cfg.remapDeveloperMessagesToUser !== false
}

export function getCodexCompactionOverrideEnabled(cfg: PluginConfig): boolean {
  if (cfg.codexCompactionOverride === true) return true
  if (cfg.codexCompactionOverride === false) return false
  return getMode(cfg) === "codex"
}

export function getHeaderSnapshotsEnabled(cfg: PluginConfig): boolean {
  return cfg.headerSnapshots === true
}

export function getHeaderTransformDebugEnabled(cfg: PluginConfig): boolean {
  return cfg.headerTransformDebug === true
}

export function getHeaderSnapshotBodiesEnabled(cfg: PluginConfig): boolean {
  return cfg.headerSnapshotBodies === true
}

export function getCollaborationProfileEnabled(cfg: PluginConfig): boolean {
  if (cfg.collaborationProfileEnabled === true) return true
  if (cfg.collaborationProfileEnabled === false) return false
  return getMode(cfg) === "codex"
}

export function getOrchestratorSubagentsEnabled(cfg: PluginConfig): boolean {
  if (cfg.orchestratorSubagentsEnabled === true) return true
  if (cfg.orchestratorSubagentsEnabled === false) return false
  return getCollaborationProfileEnabled(cfg)
}

export function getBehaviorSettings(cfg: PluginConfig): BehaviorSettings | undefined {
  return cfg.behaviorSettings
}

export function getThinkingSummariesOverride(cfg: PluginConfig): boolean | undefined {
  return cfg.behaviorSettings?.global?.thinkingSummaries
}
