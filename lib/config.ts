import fs from "node:fs"
import fsPromises from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { RotationStrategy } from "./types"

export type PersonalityOption = string
export type CodexSpoofMode = "native" | "codex"
export type PluginRuntimeMode = "native" | "codex" | "collab"

export type ModelBehaviorOverride = {
  options?: {
    personality?: PersonalityOption
  }
  thinkingSummaries?: boolean
}

export type ModelConfigOverride = ModelBehaviorOverride & {
  variants?: Record<string, ModelBehaviorOverride>
}

export type CustomSettings = {
  thinkingSummaries?: boolean
  options?: {
    personality?: PersonalityOption
  }
  models?: Record<string, ModelConfigOverride>
}

export type PluginConfig = {
  debug?: boolean
  proactiveRefresh?: boolean
  proactiveRefreshBufferMs?: number
  quietMode?: boolean
  pidOffsetEnabled?: boolean
  personality?: PersonalityOption
  mode?: PluginRuntimeMode
  rotationStrategy?: RotationStrategy
  spoofMode?: CodexSpoofMode
  compatInputSanitizer?: boolean
  headerSnapshots?: boolean
  headerTransformDebug?: boolean
  customSettings?: CustomSettings
}

const CONFIG_FILE = "codex-config.json"

export const DEFAULT_CODEX_CONFIG = {
  $schema: "https://schemas.iam-brain.dev/opencode-codex-auth/codex-config.schema.json",
  debug: false,
  quiet: false,
  refreshAhead: {
    enabled: true,
    bufferMs: 60_000
  },
  runtime: {
    mode: "native",
    rotationStrategy: "sticky",
    sanitizeInputs: false,
    headerSnapshots: false,
    headerTransformDebug: false,
    pidOffset: false
  },
  global: {
    personality: "pragmatic"
  },
  perModel: {}
} as const

const DEFAULT_CODEX_CONFIG_TEMPLATE = `{
  "$schema": "https://schemas.iam-brain.dev/opencode-codex-auth/codex-config.schema.json",

  // Enable verbose plugin debug logs.
  // options: true | false
  // default: false
  "debug": false,

  // Suppress plugin UI toasts/notifications.
  // options: true | false
  // default: false
  "quiet": false,

  // Proactively refresh access tokens before expiry.
  "refreshAhead": {
    // options: true | false
    // default: true
    "enabled": true,

    // Milliseconds before expiry to refresh.
    // default: 60000
    "bufferMs": 60000
  },

  "runtime": {
    // Request identity/profile mode.
    // options: "native" | "codex" | "collab"
    // default: "native"
    "mode": "native",

    // Account rotation strategy.
    // options: "sticky" | "hybrid" | "round_robin"
    // default: "sticky"
    "rotationStrategy": "sticky",

    // Input compatibility sanitizer for edge payloads.
    // options: true | false
    // default: false
    "sanitizeInputs": false,

    // Write request header snapshots to plugin logs.
    // options: true | false
    // default: false
    "headerSnapshots": false,

    // Capture inbound/outbound header transforms for message requests.
    // options: true | false
    // default: false
    "headerTransformDebug": false,

    // Session-aware offset for account selection.
    // options: true | false
    // default: false
    "pidOffset": false
  },

  "global": {
    // Global personality key.
    // built-ins: "pragmatic", "friendly"
    // custom: any lowercase key from personalities/<key>.md
    // default: "pragmatic"
    "personality": "pragmatic"

    // Thinking summaries behavior:
    // true  => force on
    // false => force off
    // omit  => use model default from catalog cache (recommended)
    // "thinkingSummaries": true
  },

  // Optional model-specific overrides.
  // Supports same fields as global plus nested variants.
  "perModel": {
    // "gpt-5.3-codex": {
    //   "personality": "friendly",
    //   "thinkingSummaries": true,
    //   "variants": {
    //     "high": {
    //       "personality": "pragmatic",
    //       "thinkingSummaries": false
    //     }
    //   }
    // }
  }
}
`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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

function stripJsonComments(raw: string): string {
  let out = ""
  let inString = false
  let escaped = false
  let inLineComment = false
  let inBlockComment = false

  for (let index = 0; index < raw.length; index += 1) {
    const ch = raw[index]
    const next = raw[index + 1]

    if (inLineComment) {
      if (ch === "\n" || ch === "\r") {
        inLineComment = false
        out += ch
      }
      continue
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false
        index += 1
        continue
      }
      if (ch === "\n" || ch === "\r") {
        out += ch
      }
      continue
    }

    if (inString) {
      out += ch
      if (escaped) {
        escaped = false
      } else if (ch === "\\") {
        escaped = true
      } else if (ch === "\"") {
        inString = false
      }
      continue
    }

    if (ch === "\"") {
      inString = true
      out += ch
      continue
    }

    if (ch === "/" && next === "/") {
      inLineComment = true
      index += 1
      continue
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true
      index += 1
      continue
    }

    out += ch
  }

  return out
}

export function parseConfigJsonWithComments(raw: string): unknown {
  return JSON.parse(stripJsonComments(raw)) as unknown
}

export function normalizePersonalityOption(value: unknown): PersonalityOption | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized.includes("/") || normalized.includes("\\") || normalized.includes("..")) {
    return undefined
  }
  return normalized
}

function parseSpoofMode(value: unknown): CodexSpoofMode | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "native") return "native"
  if (normalized === "codex") return "codex"
  return undefined
}

function parseRuntimeMode(value: unknown): PluginRuntimeMode | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "native") return "native"
  if (normalized === "codex") return "codex"
  if (normalized === "collab") return "collab"
  return undefined
}

function parseRotationStrategy(value: unknown): RotationStrategy | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "sticky" || normalized === "hybrid" || normalized === "round_robin") {
    return normalized
  }
  return undefined
}

function normalizeCustomSettings(raw: unknown): CustomSettings | undefined {
  if (!isRecord(raw)) return undefined

  const out: CustomSettings = {}

  if (typeof raw.thinkingSummaries === "boolean") {
    out.thinkingSummaries = raw.thinkingSummaries
  }

  const rawOptions = isRecord(raw.options) ? raw.options : undefined
  const globalPersonality = normalizePersonalityOption(rawOptions?.personality)
  if (globalPersonality) {
    out.options = { personality: globalPersonality }
  }

  const rawModels = isRecord(raw.models) ? raw.models : undefined
  if (rawModels) {
    const models: NonNullable<CustomSettings["models"]> = {}
    for (const [modelName, value] of Object.entries(rawModels)) {
      const normalized = normalizeModelConfigOverride(value)
      if (!normalized) continue
      models[modelName] = normalized
    }
    if (Object.keys(models).length > 0) {
      out.models = models
    }
  }

  if (out.thinkingSummaries === undefined && !out.options && !out.models) {
    return undefined
  }

  return out
}

type ModelBehaviorSettings = {
  personality?: PersonalityOption
  thinkingSummaries?: boolean
}

function normalizeModelBehaviorSettings(raw: unknown): ModelBehaviorSettings | undefined {
  if (!isRecord(raw)) return undefined
  const out: ModelBehaviorSettings = {}

  const options = isRecord(raw.options) ? raw.options : undefined
  const personality = normalizePersonalityOption(raw.personality) ?? normalizePersonalityOption(options?.personality)
  if (personality) out.personality = personality

  if (typeof raw.thinkingSummaries === "boolean") {
    out.thinkingSummaries = raw.thinkingSummaries
  }

  if (!out.personality && out.thinkingSummaries === undefined) {
    return undefined
  }

  return out
}

function normalizeModelConfigOverride(raw: unknown): ModelConfigOverride | undefined {
  if (!isRecord(raw)) return undefined

  const modelBehavior = normalizeModelBehaviorSettings(raw)
  const rawVariants = isRecord(raw.variants) ? raw.variants : undefined

  let variants: ModelConfigOverride["variants"] | undefined
  if (rawVariants) {
    const variantMap: NonNullable<ModelConfigOverride["variants"]> = {}
    for (const [variantName, value] of Object.entries(rawVariants)) {
      const normalized = normalizeModelBehaviorSettings(value)
      if (!normalized) continue
      variantMap[variantName] = {
        ...(normalized.personality ? { options: { personality: normalized.personality } } : {}),
        ...(normalized.thinkingSummaries !== undefined
          ? { thinkingSummaries: normalized.thinkingSummaries }
          : {})
      }
    }
    if (Object.keys(variantMap).length > 0) {
      variants = variantMap
    }
  }

  if (!modelBehavior && !variants) {
    return undefined
  }

  return {
    ...(modelBehavior?.personality ? { options: { personality: modelBehavior.personality } } : {}),
    ...(modelBehavior?.thinkingSummaries !== undefined
      ? { thinkingSummaries: modelBehavior.thinkingSummaries }
      : {}),
    ...(variants ? { variants } : {})
  }
}

function normalizeNewBehaviorSections(raw: Record<string, unknown>): CustomSettings | undefined {
  const global = normalizeModelBehaviorSettings(raw.global)
  const perModelRaw = isRecord(raw.perModel) ? raw.perModel : undefined

  let models: CustomSettings["models"] | undefined
  if (perModelRaw) {
    const modelMap: NonNullable<CustomSettings["models"]> = {}
    for (const [modelName, value] of Object.entries(perModelRaw)) {
      const normalized = normalizeModelConfigOverride(value)
      if (!normalized) continue
      modelMap[modelName] = normalized
    }
    if (Object.keys(modelMap).length > 0) {
      models = modelMap
    }
  }

  if (!global && !models) {
    return undefined
  }

  return {
    ...(global?.personality ? { options: { personality: global.personality } } : {}),
    ...(global?.thinkingSummaries !== undefined
      ? { thinkingSummaries: global.thinkingSummaries }
      : {}),
    ...(models ? { models } : {})
  }
}

function mergeCustomSettings(
  primary: CustomSettings | undefined,
  secondary: CustomSettings | undefined
): CustomSettings | undefined {
  if (!primary && !secondary) return undefined
  if (!primary) return secondary
  if (!secondary) return primary

  const modelKeys = new Set<string>([
    ...Object.keys(primary.models ?? {}),
    ...Object.keys(secondary.models ?? {})
  ])
  let models: CustomSettings["models"] | undefined
  if (modelKeys.size > 0) {
    const merged: NonNullable<CustomSettings["models"]> = {}
    for (const key of modelKeys) {
      const a = primary.models?.[key]
      const b = secondary.models?.[key]
      const personality =
        b?.options?.personality !== undefined
          ? b.options.personality
          : a?.options?.personality
      const thinkingSummaries =
        b?.thinkingSummaries !== undefined ? b.thinkingSummaries : a?.thinkingSummaries
      const variantKeys = new Set<string>([
        ...Object.keys(a?.variants ?? {}),
        ...Object.keys(b?.variants ?? {})
      ])
      let variants: ModelConfigOverride["variants"] | undefined
      if (variantKeys.size > 0) {
        const variantMap: NonNullable<ModelConfigOverride["variants"]> = {}
        for (const variantKey of variantKeys) {
          const base = a?.variants?.[variantKey]
          const override = b?.variants?.[variantKey]
          const variantPersonality =
            override?.options?.personality !== undefined
              ? override.options.personality
              : base?.options?.personality
          const variantThinkingSummaries =
            override?.thinkingSummaries !== undefined
              ? override.thinkingSummaries
              : base?.thinkingSummaries
          if (variantPersonality === undefined && variantThinkingSummaries === undefined) continue
          variantMap[variantKey] = {
            ...(variantPersonality ? { options: { personality: variantPersonality } } : {}),
            ...(variantThinkingSummaries !== undefined
              ? { thinkingSummaries: variantThinkingSummaries }
              : {})
          }
        }
        if (Object.keys(variantMap).length > 0) {
          variants = variantMap
        }
      }
      if (personality === undefined && thinkingSummaries === undefined && !variants) continue
      merged[key] = {
        ...(personality ? { options: { personality } } : {}),
        ...(thinkingSummaries !== undefined ? { thinkingSummaries } : {}),
        ...(variants ? { variants } : {})
      }
    }
    if (Object.keys(merged).length > 0) {
      models = merged
    }
  }

  const mergedPersonality =
    secondary.options?.personality !== undefined
      ? secondary.options.personality
      : primary.options?.personality

  return {
    thinkingSummaries:
      secondary.thinkingSummaries !== undefined
        ? secondary.thinkingSummaries
        : primary.thinkingSummaries,
    ...(mergedPersonality ? { options: { personality: mergedPersonality } } : {}),
    ...(models ? { models } : {})
  }
}

function cloneCustomSettings(input: CustomSettings | undefined): CustomSettings | undefined {
  if (!input) return undefined
  return {
    thinkingSummaries: input.thinkingSummaries,
    options: input.options ? { ...input.options } : undefined,
    models: input.models
      ? Object.fromEntries(
          Object.entries(input.models).map(([key, value]) => [
            key,
            {
              ...(value.options ? { options: { ...value.options } } : {}),
              ...(value.thinkingSummaries !== undefined
                ? { thinkingSummaries: value.thinkingSummaries }
                : {}),
              ...(value.variants
                ? {
                    variants: Object.fromEntries(
                      Object.entries(value.variants).map(([variantKey, variantValue]) => [
                        variantKey,
                        {
                          ...(variantValue.options ? { options: { ...variantValue.options } } : {}),
                          ...(variantValue.thinkingSummaries !== undefined
                            ? { thinkingSummaries: variantValue.thinkingSummaries }
                            : {})
                        }
                      ])
                    )
                  }
                : {})
            }
          ])
        )
      : undefined
  }
}

function parseConfigFileObject(raw: unknown): Partial<PluginConfig> {
  if (!isRecord(raw)) return {}

  const explicitCustomSettings = normalizeCustomSettings(raw.customSettings)
  const newCustomSettings = normalizeNewBehaviorSections(raw)
  const customSettings = mergeCustomSettings(explicitCustomSettings, newCustomSettings)
  const personalityFromTopLevel = normalizePersonalityOption(raw.personality)
  const personalityFromCustom = customSettings?.options?.personality

  const debug = typeof raw.debug === "boolean" ? raw.debug : undefined
  const proactiveRefresh =
    isRecord(raw.refreshAhead) && typeof raw.refreshAhead.enabled === "boolean"
      ? raw.refreshAhead.enabled
      : undefined
  const proactiveRefreshBufferMs =
    isRecord(raw.refreshAhead) && typeof raw.refreshAhead.bufferMs === "number"
      ? raw.refreshAhead.bufferMs
      : undefined
  const quietMode = typeof raw.quiet === "boolean" ? raw.quiet : undefined
  const mode = parseRuntimeMode(isRecord(raw.runtime) ? raw.runtime.mode : undefined)
  const rotationStrategy = parseRotationStrategy(
    isRecord(raw.runtime) ? raw.runtime.rotationStrategy : undefined
  )
  const spoofMode = mode === "native" ? "native" : mode === "codex" || mode === "collab" ? "codex" : undefined
  const compatInputSanitizer =
    isRecord(raw.runtime) && typeof raw.runtime.sanitizeInputs === "boolean"
      ? raw.runtime.sanitizeInputs
      : undefined
  const headerSnapshots =
    isRecord(raw.runtime) && typeof raw.runtime.headerSnapshots === "boolean"
      ? raw.runtime.headerSnapshots
      : undefined
  const headerTransformDebug =
    isRecord(raw.runtime) && typeof raw.runtime.headerTransformDebug === "boolean"
      ? raw.runtime.headerTransformDebug
      : undefined
  const pidOffsetEnabled =
    isRecord(raw.runtime) && typeof raw.runtime.pidOffset === "boolean"
      ? raw.runtime.pidOffset
      : undefined

  return {
    debug,
    proactiveRefresh,
    proactiveRefreshBufferMs,
    quietMode,
    pidOffsetEnabled,
    personality: personalityFromTopLevel ?? personalityFromCustom,
    mode,
    rotationStrategy,
    spoofMode,
    compatInputSanitizer,
    headerSnapshots,
    headerTransformDebug,
    customSettings
  }
}

export function resolveDefaultConfigPath(env: Record<string, string | undefined>): string {
  const xdgRoot = env.XDG_CONFIG_HOME?.trim()
  if (xdgRoot) {
    return path.join(xdgRoot, "opencode", CONFIG_FILE)
  }
  return path.join(os.homedir(), ".config", "opencode", CONFIG_FILE)
}

export type EnsureDefaultConfigFileResult = {
  filePath: string
  created: boolean
}

export async function ensureDefaultConfigFile(input: {
  env?: Record<string, string | undefined>
  filePath?: string
  overwrite?: boolean
} = {}): Promise<EnsureDefaultConfigFileResult> {
  const env = input.env ?? process.env
  const filePath = input.filePath ?? resolveDefaultConfigPath(env)
  const overwrite = input.overwrite === true

  if (!overwrite && fs.existsSync(filePath)) {
    return { filePath, created: false }
  }

  await fsPromises.mkdir(path.dirname(filePath), { recursive: true })
  const content = DEFAULT_CODEX_CONFIG_TEMPLATE
  await fsPromises.writeFile(filePath, content, { encoding: "utf8", mode: 0o600 })
  return { filePath, created: true }
}

export function loadConfigFile(input: {
  env?: Record<string, string | undefined>
  filePath?: string
} = {}): Partial<PluginConfig> {
  const env = input.env ?? process.env
  const explicitPath = input.filePath ?? env.OPENCODE_OPENAI_MULTI_CONFIG_PATH?.trim()

  const candidates = explicitPath ? [explicitPath] : [resolveDefaultConfigPath(env)]

  for (const filePath of candidates) {
    if (!filePath) continue
    if (!fs.existsSync(filePath)) continue
    try {
      const raw = fs.readFileSync(filePath, "utf8")
      const parsed = parseConfigJsonWithComments(raw)
      return parseConfigFileObject(parsed)
    } catch {
      return {}
    }
  }

  return {}
}

export function resolveConfig(input: {
  env: Record<string, string | undefined>
  file?: Partial<PluginConfig>
}): PluginConfig {
  const env = input.env
  const file = input.file ?? {}
  const fileCustom = normalizeCustomSettings(file.customSettings)

  const envDebug =
    env.OPENCODE_OPENAI_MULTI_DEBUG === "1" ||
    env.DEBUG_CODEX_PLUGIN === "1"

  const proactiveRefresh =
    parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH) ?? file.proactiveRefresh
  const proactiveRefreshBufferMs =
    parseEnvNumber(env.OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH_BUFFER_MS) ??
    file.proactiveRefreshBufferMs
  const quietMode =
    parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_QUIET) ?? file.quietMode
  const pidOffsetEnabled =
    parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_PID_OFFSET) ?? file.pidOffsetEnabled
  const rotationStrategy =
    parseRotationStrategy(env.OPENCODE_OPENAI_MULTI_ROTATION_STRATEGY) ??
    file.rotationStrategy

  const envPersonality = normalizePersonalityOption(env.OPENCODE_OPENAI_MULTI_PERSONALITY)
  const envThinkingSummaries = parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_THINKING_SUMMARIES)
  const spoofModeFromEnv = parseSpoofMode(env.OPENCODE_OPENAI_MULTI_SPOOF_MODE)
  const modeFromEnv = parseRuntimeMode(env.OPENCODE_OPENAI_MULTI_MODE)
  const modeFromSpoofEnv =
    modeFromEnv === undefined && spoofModeFromEnv !== undefined
      ? spoofModeFromEnv === "codex"
        ? "codex"
        : "native"
      : undefined
  const mode =
    modeFromEnv ??
    modeFromSpoofEnv ??
    file.mode ??
    (spoofModeFromEnv === "codex" || file.spoofMode === "codex" ? "codex" : "native")

  const customSettings = cloneCustomSettings(fileCustom)

  if (envPersonality) {
    if (!customSettings) {
      // Keep behavior deterministic by ensuring one source of truth for runtime resolution.
      input.file = { ...file, customSettings: { options: { personality: envPersonality } } }
    } else {
      customSettings.options = { ...(customSettings.options ?? {}), personality: envPersonality }
    }
  }
  if (envThinkingSummaries !== undefined) {
    if (!customSettings) {
      input.file = {
        ...file,
        customSettings: { ...(input.file?.customSettings ?? {}), thinkingSummaries: envThinkingSummaries }
      }
    } else {
      customSettings.thinkingSummaries = envThinkingSummaries
    }
  }

  const resolvedCustomSettings =
    customSettings ??
    cloneCustomSettings(normalizeCustomSettings(input.file?.customSettings)) ??
    (envPersonality || envThinkingSummaries !== undefined
      ? {
          ...(envPersonality ? { options: { personality: envPersonality } } : {}),
          ...(envThinkingSummaries !== undefined ? { thinkingSummaries: envThinkingSummaries } : {})
        }
      : undefined)

  const personality =
    envPersonality ??
    file.personality ??
    resolvedCustomSettings?.options?.personality

  const spoofMode =
    spoofModeFromEnv ??
    file.spoofMode ??
    (mode === "native" ? "native" : "codex")
  const compatInputSanitizer =
    parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_COMPAT_INPUT_SANITIZER) ?? file.compatInputSanitizer
  const headerSnapshots =
    parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS) ?? file.headerSnapshots
  const headerTransformDebug =
    parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_HEADER_TRANSFORM_DEBUG) ?? file.headerTransformDebug

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
    spoofMode,
    compatInputSanitizer,
    headerSnapshots,
    headerTransformDebug,
    customSettings: resolvedCustomSettings
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
  if (cfg.mode === "native" || cfg.mode === "codex" || cfg.mode === "collab") return cfg.mode
  return getSpoofMode(cfg) === "codex" ? "codex" : "native"
}

export function getRotationStrategy(cfg: PluginConfig): RotationStrategy {
  return cfg.rotationStrategy === "hybrid" || cfg.rotationStrategy === "round_robin"
    ? cfg.rotationStrategy
    : "sticky"
}

export function getCompatInputSanitizerEnabled(cfg: PluginConfig): boolean {
  return cfg.compatInputSanitizer === true
}

export function getHeaderSnapshotsEnabled(cfg: PluginConfig): boolean {
  return cfg.headerSnapshots === true
}

export function getHeaderTransformDebugEnabled(cfg: PluginConfig): boolean {
  return cfg.headerTransformDebug === true
}

export function getCustomSettings(cfg: PluginConfig): CustomSettings | undefined {
  return cfg.customSettings
}

export function getThinkingSummariesOverride(cfg: PluginConfig): boolean | undefined {
  return cfg.customSettings?.thinkingSummaries
}
