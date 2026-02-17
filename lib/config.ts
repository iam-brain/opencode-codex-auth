import fs from "node:fs"
import fsPromises from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { RotationStrategy } from "./types"
import { isRecord } from "./util"

export type PersonalityOption = string
export type CodexSpoofMode = "native" | "codex"
export type PluginRuntimeMode = "native" | "codex"
export type VerbosityOption = "default" | "low" | "medium" | "high"
export type PromptCacheKeyStrategy = "default" | "project"
export type CollaborationToolProfile = "opencode" | "codex"

export type ModelBehaviorOverride = {
  personality?: PersonalityOption
  thinkingSummaries?: boolean
  verbosityEnabled?: boolean
  verbosity?: VerbosityOption
}

export type ModelConfigOverride = ModelBehaviorOverride & {
  variants?: Record<string, ModelBehaviorOverride>
}

export type BehaviorSettings = {
  global?: ModelBehaviorOverride
  perModel?: Record<string, ModelConfigOverride>
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
  remapDeveloperMessagesToUser?: boolean
  codexCompactionOverride?: boolean
  headerSnapshots?: boolean
  headerSnapshotBodies?: boolean
  headerTransformDebug?: boolean
  promptCacheKeyStrategy?: PromptCacheKeyStrategy
  collaborationProfileEnabled?: boolean
  orchestratorSubagentsEnabled?: boolean
  collaborationToolProfile?: CollaborationToolProfile
  behaviorSettings?: BehaviorSettings
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
    developerMessagesToUser: true,
    promptCacheKeyStrategy: "default",
    headerSnapshots: false,
    headerSnapshotBodies: false,
    headerTransformDebug: false,
    pidOffset: false
  },
  global: {
    personality: "pragmatic",
    verbosityEnabled: true,
    verbosity: "default"
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
    // options: "native" | "codex"
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

    // Experimental: remap non-permissions developer messages to user role.
    // Only applies when runtime.mode is "codex".
    // options: true | false
    // default: true
    "developerMessagesToUser": true,

    // Prompt cache key policy.
    // "default" keeps upstream session-based keys.
    // "project" overrides with a hashed project path + runtime mode key.
    // options: "default" | "project"
    // default: "default"
    "promptCacheKeyStrategy": "default",

    // Write request header snapshots to plugin logs.
    // options: true | false
    // default: false
    "headerSnapshots": false,

    // Capture request bodies in snapshot files.
    // options: true | false
    // default: false
    "headerSnapshotBodies": false,

    // Capture inbound/outbound header transforms for message requests.
    // options: true | false
    // default: false
    "headerTransformDebug": false,

    // Session-aware offset for account selection.
    // options: true | false
    // default: false
    "pidOffset": false

    // Experimental collaboration controls (optional):
    // "collaborationProfile": true,
    // "orchestratorSubagents": true,
    // "collaborationToolProfile": "opencode" // "opencode" | "codex"
  },

  "global": {
    // Global personality key.
    // built-ins: "pragmatic", "friendly"
    // custom: any lowercase key from personalities/<key>.md
    // default: "pragmatic"
    "personality": "pragmatic",

    // Thinking summaries behavior:
    // true  => force on
    // false => force off
    // omit  => use model default from catalog cache (recommended)
    // "thinkingSummaries": true

    // Text verbosity behavior:
    // verbosityEnabled: true  => apply verbosity setting/default
    // verbosityEnabled: false => do not send textVerbosity
    // default: true
    "verbosityEnabled": true,

    // options: "default" | "low" | "medium" | "high"
    // "default" uses each model's catalog default verbosity.
    // default: "default"
    "verbosity": "default"
  },

  // Optional model-specific overrides.
  // Supports same fields as global plus nested variants.
  "perModel": {
     // "gpt-5.3-codex": {
     //   "personality": "friendly",
     //   "thinkingSummaries": true,
     //   "verbosityEnabled": true,
     //   "verbosity": "default",
     //   "variants": {
     //     "high": {
     //       "personality": "pragmatic",
     //       "thinkingSummaries": false,
     //       "verbosityEnabled": true,
     //       "verbosity": "high"
     //     }
     //   }
     // }
  }
}
`

function describeValueType(value: unknown): string {
  if (Array.isArray(value)) return "array"
  if (value === null) return "null"
  return typeof value
}

function pushValidationIssue(
  issues: string[],
  input: {
    path: string
    expected: string
    actual: unknown
  }
): void {
  issues.push(`${input.path}: expected ${input.expected}, got ${describeValueType(input.actual)}`)
}

function validateModelBehaviorShape(value: unknown, pathPrefix: string, issues: string[]): void {
  if (!isRecord(value)) {
    pushValidationIssue(issues, { path: pathPrefix, expected: "object", actual: value })
    return
  }

  if ("personality" in value && typeof value.personality !== "string") {
    pushValidationIssue(issues, { path: `${pathPrefix}.personality`, expected: "string", actual: value.personality })
  }
  if ("thinkingSummaries" in value && typeof value.thinkingSummaries !== "boolean") {
    pushValidationIssue(issues, {
      path: `${pathPrefix}.thinkingSummaries`,
      expected: "boolean",
      actual: value.thinkingSummaries
    })
  }
  if ("verbosityEnabled" in value && typeof value.verbosityEnabled !== "boolean") {
    pushValidationIssue(issues, {
      path: `${pathPrefix}.verbosityEnabled`,
      expected: "boolean",
      actual: value.verbosityEnabled
    })
  }
  if ("verbosity" in value) {
    const verbosity = value.verbosity
    const normalized = typeof verbosity === "string" ? verbosity.trim().toLowerCase() : ""
    if (!(normalized === "default" || normalized === "low" || normalized === "medium" || normalized === "high")) {
      pushValidationIssue(issues, {
        path: `${pathPrefix}.verbosity`,
        expected: '"default" | "low" | "medium" | "high"',
        actual: verbosity
      })
    }
  }
}

export type ConfigValidationResult = {
  valid: boolean
  issues: string[]
}

export function validateConfigFileObject(raw: unknown): ConfigValidationResult {
  const issues: string[] = []
  if (!isRecord(raw)) {
    pushValidationIssue(issues, { path: "$", expected: "object", actual: raw })
    return { valid: false, issues }
  }

  if ("$schema" in raw && typeof raw.$schema !== "string") {
    pushValidationIssue(issues, { path: "$schema", expected: "string", actual: raw.$schema })
  }
  if ("debug" in raw && typeof raw.debug !== "boolean") {
    pushValidationIssue(issues, { path: "debug", expected: "boolean", actual: raw.debug })
  }
  if ("quiet" in raw && typeof raw.quiet !== "boolean") {
    pushValidationIssue(issues, { path: "quiet", expected: "boolean", actual: raw.quiet })
  }

  if ("refreshAhead" in raw) {
    if (!isRecord(raw.refreshAhead)) {
      pushValidationIssue(issues, { path: "refreshAhead", expected: "object", actual: raw.refreshAhead })
    } else {
      if ("enabled" in raw.refreshAhead && typeof raw.refreshAhead.enabled !== "boolean") {
        pushValidationIssue(issues, {
          path: "refreshAhead.enabled",
          expected: "boolean",
          actual: raw.refreshAhead.enabled
        })
      }
      if (
        "bufferMs" in raw.refreshAhead &&
        (typeof raw.refreshAhead.bufferMs !== "number" || !Number.isFinite(raw.refreshAhead.bufferMs))
      ) {
        pushValidationIssue(issues, {
          path: "refreshAhead.bufferMs",
          expected: "number",
          actual: raw.refreshAhead.bufferMs
        })
      }
    }
  }

  if ("runtime" in raw) {
    if (!isRecord(raw.runtime)) {
      pushValidationIssue(issues, { path: "runtime", expected: "object", actual: raw.runtime })
    } else {
      const runtime = raw.runtime
      const enumChecks: Array<{ field: string; allowed: string[] }> = [
        { field: "mode", allowed: ["native", "codex"] },
        { field: "rotationStrategy", allowed: ["sticky", "hybrid", "round_robin"] },
        { field: "promptCacheKeyStrategy", allowed: ["default", "project"] },
        { field: "collaborationToolProfile", allowed: ["opencode", "codex"] }
      ]
      for (const check of enumChecks) {
        const value = runtime[check.field]
        if (value === undefined) continue
        const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""
        if (!check.allowed.includes(normalized)) {
          pushValidationIssue(issues, {
            path: `runtime.${check.field}`,
            expected: check.allowed.map((item) => `"${item}"`).join(" | "),
            actual: value
          })
        }
      }

      const boolFields = [
        "sanitizeInputs",
        "developerMessagesToUser",
        "codexCompactionOverride",
        "headerSnapshots",
        "headerSnapshotBodies",
        "headerTransformDebug",
        "pidOffset",
        "collaborationProfile",
        "orchestratorSubagents"
      ]
      for (const field of boolFields) {
        if (field in runtime && typeof runtime[field] !== "boolean") {
          pushValidationIssue(issues, {
            path: `runtime.${field}`,
            expected: "boolean",
            actual: runtime[field]
          })
        }
      }
    }
  }

  if ("global" in raw) {
    validateModelBehaviorShape(raw.global, "global", issues)
  }

  if ("perModel" in raw) {
    if (!isRecord(raw.perModel)) {
      pushValidationIssue(issues, { path: "perModel", expected: "object", actual: raw.perModel })
    } else {
      for (const [modelName, modelValue] of Object.entries(raw.perModel)) {
        validateModelBehaviorShape(modelValue, `perModel.${modelName}`, issues)
        if (!isRecord(modelValue)) continue
        if (!("variants" in modelValue)) continue

        const variants = modelValue.variants
        if (!isRecord(variants)) {
          pushValidationIssue(issues, {
            path: `perModel.${modelName}.variants`,
            expected: "object",
            actual: variants
          })
          continue
        }
        for (const [variantName, variantValue] of Object.entries(variants)) {
          validateModelBehaviorShape(variantValue, `perModel.${modelName}.variants.${variantName}`, issues)
        }
      }
    }
  }

  return { valid: issues.length === 0, issues }
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
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
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

function parsePromptCacheKeyStrategy(value: unknown): PromptCacheKeyStrategy | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "default" || normalized === "project") return normalized
  return undefined
}

function parseCollaborationToolProfile(value: unknown): CollaborationToolProfile | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "opencode" || normalized === "codex") {
    return normalized
  }
  return undefined
}

function normalizeVerbosityOption(value: unknown): VerbosityOption | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "default" || normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized
  }
  return undefined
}

type ModelBehaviorSettings = {
  personality?: PersonalityOption
  thinkingSummaries?: boolean
  verbosityEnabled?: boolean
  verbosity?: VerbosityOption
}

function normalizeModelBehaviorSettings(raw: unknown): ModelBehaviorSettings | undefined {
  if (!isRecord(raw)) return undefined
  const out: ModelBehaviorSettings = {}

  const personality = normalizePersonalityOption(raw.personality)
  if (personality) out.personality = personality

  if (typeof raw.thinkingSummaries === "boolean") {
    out.thinkingSummaries = raw.thinkingSummaries
  }

  if (typeof raw.verbosityEnabled === "boolean") {
    out.verbosityEnabled = raw.verbosityEnabled
  }

  const verbosity = normalizeVerbosityOption(raw.verbosity)
  if (verbosity) {
    out.verbosity = verbosity
  }

  if (
    !out.personality &&
    out.thinkingSummaries === undefined &&
    out.verbosityEnabled === undefined &&
    out.verbosity === undefined
  ) {
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
        ...(normalized.personality ? { personality: normalized.personality } : {}),
        ...(normalized.thinkingSummaries !== undefined ? { thinkingSummaries: normalized.thinkingSummaries } : {}),
        ...(normalized.verbosityEnabled !== undefined ? { verbosityEnabled: normalized.verbosityEnabled } : {}),
        ...(normalized.verbosity ? { verbosity: normalized.verbosity } : {})
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
    ...(modelBehavior?.personality ? { personality: modelBehavior.personality } : {}),
    ...(modelBehavior?.thinkingSummaries !== undefined ? { thinkingSummaries: modelBehavior.thinkingSummaries } : {}),
    ...(modelBehavior?.verbosityEnabled !== undefined ? { verbosityEnabled: modelBehavior.verbosityEnabled } : {}),
    ...(modelBehavior?.verbosity ? { verbosity: modelBehavior.verbosity } : {}),
    ...(variants ? { variants } : {})
  }
}

function normalizeNewBehaviorSections(raw: Record<string, unknown>): BehaviorSettings | undefined {
  const global = normalizeModelBehaviorSettings(raw.global)
  const perModelRaw = isRecord(raw.perModel) ? raw.perModel : undefined

  let perModel: BehaviorSettings["perModel"] | undefined
  if (perModelRaw) {
    const modelMap: NonNullable<BehaviorSettings["perModel"]> = {}
    for (const [modelName, value] of Object.entries(perModelRaw)) {
      const normalized = normalizeModelConfigOverride(value)
      if (!normalized) continue
      modelMap[modelName] = normalized
    }
    if (Object.keys(modelMap).length > 0) {
      perModel = modelMap
    }
  }

  if (!global && !perModel) {
    return undefined
  }

  return {
    ...(global ? { global } : {}),
    ...(perModel ? { perModel } : {})
  }
}

function cloneBehaviorSettings(input: BehaviorSettings | undefined): BehaviorSettings | undefined {
  if (!input) return undefined
  return {
    ...(input.global
      ? {
          global: {
            ...input.global
          }
        }
      : {}),
    perModel: input.perModel
      ? Object.fromEntries(
          Object.entries(input.perModel).map(([key, value]) => [
            key,
            {
              ...(value.personality !== undefined ? { personality: value.personality } : {}),
              ...(value.thinkingSummaries !== undefined ? { thinkingSummaries: value.thinkingSummaries } : {}),
              ...(value.verbosityEnabled !== undefined ? { verbosityEnabled: value.verbosityEnabled } : {}),
              ...(value.verbosity !== undefined ? { verbosity: value.verbosity } : {}),
              ...(value.variants
                ? {
                    variants: Object.fromEntries(
                      Object.entries(value.variants).map(([variantKey, variantValue]) => [
                        variantKey,
                        {
                          ...(variantValue.personality !== undefined ? { personality: variantValue.personality } : {}),
                          ...(variantValue.thinkingSummaries !== undefined
                            ? { thinkingSummaries: variantValue.thinkingSummaries }
                            : {}),
                          ...(variantValue.verbosityEnabled !== undefined
                            ? { verbosityEnabled: variantValue.verbosityEnabled }
                            : {}),
                          ...(variantValue.verbosity !== undefined ? { verbosity: variantValue.verbosity } : {})
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

  const behaviorSettings = normalizeNewBehaviorSections(raw)
  const personalityFromBehavior = behaviorSettings?.global?.personality

  const debug = typeof raw.debug === "boolean" ? raw.debug : undefined
  const proactiveRefresh =
    isRecord(raw.refreshAhead) && typeof raw.refreshAhead.enabled === "boolean" ? raw.refreshAhead.enabled : undefined
  const proactiveRefreshBufferMs =
    isRecord(raw.refreshAhead) && typeof raw.refreshAhead.bufferMs === "number" ? raw.refreshAhead.bufferMs : undefined
  const quietMode = typeof raw.quiet === "boolean" ? raw.quiet : undefined
  const mode = parseRuntimeMode(isRecord(raw.runtime) ? raw.runtime.mode : undefined)
  const rotationStrategy = parseRotationStrategy(isRecord(raw.runtime) ? raw.runtime.rotationStrategy : undefined)
  const promptCacheKeyStrategy = parsePromptCacheKeyStrategy(
    isRecord(raw.runtime) ? raw.runtime.promptCacheKeyStrategy : undefined
  )
  const spoofMode = mode === "native" ? "native" : mode === "codex" ? "codex" : undefined
  const compatInputSanitizer =
    isRecord(raw.runtime) && typeof raw.runtime.sanitizeInputs === "boolean" ? raw.runtime.sanitizeInputs : undefined
  const remapDeveloperMessagesToUser =
    isRecord(raw.runtime) && typeof raw.runtime.developerMessagesToUser === "boolean"
      ? raw.runtime.developerMessagesToUser
      : undefined
  const codexCompactionOverride =
    isRecord(raw.runtime) && typeof raw.runtime.codexCompactionOverride === "boolean"
      ? raw.runtime.codexCompactionOverride
      : undefined
  const headerSnapshots =
    isRecord(raw.runtime) && typeof raw.runtime.headerSnapshots === "boolean" ? raw.runtime.headerSnapshots : undefined
  const headerSnapshotBodies =
    isRecord(raw.runtime) && typeof raw.runtime.headerSnapshotBodies === "boolean"
      ? raw.runtime.headerSnapshotBodies
      : undefined
  const headerTransformDebug =
    isRecord(raw.runtime) && typeof raw.runtime.headerTransformDebug === "boolean"
      ? raw.runtime.headerTransformDebug
      : undefined
  const pidOffsetEnabled =
    isRecord(raw.runtime) && typeof raw.runtime.pidOffset === "boolean" ? raw.runtime.pidOffset : undefined
  const collaborationProfileEnabled =
    isRecord(raw.runtime) && typeof raw.runtime.collaborationProfile === "boolean"
      ? raw.runtime.collaborationProfile
      : undefined
  const orchestratorSubagentsEnabled =
    isRecord(raw.runtime) && typeof raw.runtime.orchestratorSubagents === "boolean"
      ? raw.runtime.orchestratorSubagents
      : undefined
  const collaborationToolProfile = parseCollaborationToolProfile(
    isRecord(raw.runtime) ? raw.runtime.collaborationToolProfile : undefined
  )

  return {
    debug,
    proactiveRefresh,
    proactiveRefreshBufferMs,
    quietMode,
    pidOffsetEnabled,
    personality: personalityFromBehavior,
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
    collaborationToolProfile,
    behaviorSettings
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

export async function ensureDefaultConfigFile(
  input: {
    env?: Record<string, string | undefined>
    filePath?: string
    overwrite?: boolean
  } = {}
): Promise<EnsureDefaultConfigFileResult> {
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

export function loadConfigFile(
  input: {
    env?: Record<string, string | undefined>
    filePath?: string
  } = {}
): Partial<PluginConfig> {
  const env = input.env ?? process.env
  const explicitPath = input.filePath ?? env.OPENCODE_OPENAI_MULTI_CONFIG_PATH?.trim()

  const candidates = explicitPath ? [explicitPath] : [resolveDefaultConfigPath(env)]

  for (const filePath of candidates) {
    if (!filePath) continue
    if (!fs.existsSync(filePath)) continue
    try {
      const raw = fs.readFileSync(filePath, "utf8")
      const parsed = parseConfigJsonWithComments(raw)
      const validation = validateConfigFileObject(parsed)
      if (!validation.valid) {
        console.warn(
          `[opencode-codex-auth] Invalid codex-config at ${filePath}; ignoring file. ${validation.issues.join("; ")}`
        )
        return {}
      }
      return parseConfigFileObject(parsed)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.warn(`[opencode-codex-auth] Failed to read codex-config at ${filePath}; ignoring file. ${detail}`)
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
  const fileBehavior = cloneBehaviorSettings(file.behaviorSettings)

  const envDebug = env.OPENCODE_OPENAI_MULTI_DEBUG === "1" || env.DEBUG_CODEX_PLUGIN === "1"

  const proactiveRefresh = parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH) ?? file.proactiveRefresh
  const proactiveRefreshBufferMs =
    parseEnvNumber(env.OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH_BUFFER_MS) ?? file.proactiveRefreshBufferMs
  const quietMode = parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_QUIET) ?? file.quietMode
  const pidOffsetEnabled = parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_PID_OFFSET) ?? file.pidOffsetEnabled
  const rotationStrategy = parseRotationStrategy(env.OPENCODE_OPENAI_MULTI_ROTATION_STRATEGY) ?? file.rotationStrategy
  const promptCacheKeyStrategy =
    parsePromptCacheKeyStrategy(env.OPENCODE_OPENAI_MULTI_PROMPT_CACHE_KEY_STRATEGY) ?? file.promptCacheKeyStrategy

  const envPersonality = normalizePersonalityOption(env.OPENCODE_OPENAI_MULTI_PERSONALITY)
  const envThinkingSummaries = parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_THINKING_SUMMARIES)
  const envVerbosityEnabled = parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_VERBOSITY_ENABLED)
  const envVerbosity = normalizeVerbosityOption(env.OPENCODE_OPENAI_MULTI_VERBOSITY)
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

  const behaviorSettings = cloneBehaviorSettings(fileBehavior) ?? {}
  const globalBehavior: ModelBehaviorOverride = {
    ...(behaviorSettings.global ?? {})
  }

  if (envPersonality) {
    globalBehavior.personality = envPersonality
  }
  if (envThinkingSummaries !== undefined) {
    globalBehavior.thinkingSummaries = envThinkingSummaries
  }
  if (envVerbosityEnabled !== undefined) {
    globalBehavior.verbosityEnabled = envVerbosityEnabled
  }
  if (envVerbosity) {
    globalBehavior.verbosity = envVerbosity
  }

  if (
    globalBehavior.personality !== undefined ||
    globalBehavior.thinkingSummaries !== undefined ||
    globalBehavior.verbosityEnabled !== undefined ||
    globalBehavior.verbosity !== undefined
  ) {
    behaviorSettings.global = globalBehavior
  }

  const resolvedBehaviorSettings =
    behaviorSettings.global !== undefined || behaviorSettings.perModel !== undefined ? behaviorSettings : undefined

  const personality = envPersonality ?? resolvedBehaviorSettings?.global?.personality

  // Runtime mode is canonical; spoofMode remains a compatibility input only.
  // If runtime mode is explicitly set via env, ignore spoof env for consistency.
  const spoofMode =
    modeFromEnv !== undefined
      ? mode === "native"
        ? "native"
        : "codex"
      : (spoofModeFromEnv ?? (mode === "native" ? "native" : "codex"))
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
    parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_COLLABORATION_PROFILE) ?? file.collaborationProfileEnabled
  const orchestratorSubagentsEnabled =
    parseEnvBoolean(env.OPENCODE_OPENAI_MULTI_ORCHESTRATOR_SUBAGENTS) ?? file.orchestratorSubagentsEnabled
  const collaborationToolProfile =
    parseCollaborationToolProfile(env.OPENCODE_OPENAI_MULTI_COLLABORATION_TOOL_PROFILE) ?? file.collaborationToolProfile

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
    collaborationToolProfile,
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

export function getCollaborationToolProfile(cfg: PluginConfig): CollaborationToolProfile {
  return cfg.collaborationToolProfile === "codex" ? "codex" : "opencode"
}

export function getBehaviorSettings(cfg: PluginConfig): BehaviorSettings | undefined {
  return cfg.behaviorSettings
}

export function getThinkingSummariesOverride(cfg: PluginConfig): boolean | undefined {
  return cfg.behaviorSettings?.global?.thinkingSummaries
}
