import type { RotationStrategy } from "../types.js"
import { isRecord } from "../util.js"
import type {
  BehaviorSettings,
  CodexSpoofMode,
  ModelBehaviorOverride,
  ModelConfigOverride,
  PersonalityOption,
  PluginConfig,
  PluginRuntimeMode,
  PromptCacheKeyStrategy,
  VerbosityOption
} from "./types.js"
export function parseEnvBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false
  return undefined
}
export function parseEnvNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  if (value.trim().length === 0) return undefined
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
export function parseSpoofMode(value: unknown): CodexSpoofMode | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "native") return "native"
  if (normalized === "codex") return "codex"
  return undefined
}
export function parseRuntimeMode(value: unknown): PluginRuntimeMode | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "native") return "native"
  if (normalized === "codex") return "codex"
  return undefined
}
export function parseRotationStrategy(value: unknown): RotationStrategy | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "sticky" || normalized === "hybrid" || normalized === "round_robin") {
    return normalized
  }
  return undefined
}
export function parsePromptCacheKeyStrategy(value: unknown): PromptCacheKeyStrategy | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "default" || normalized === "project") return normalized
  return undefined
}
export function normalizeVerbosityOption(value: unknown): VerbosityOption | undefined {
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

export function cloneBehaviorSettings(input: BehaviorSettings | undefined): BehaviorSettings | undefined {
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

export function parseConfigFileObject(raw: unknown): Partial<PluginConfig> {
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

  return {
    debug,
    proactiveRefresh,
    proactiveRefreshBufferMs,
    quiet: quietMode,
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
    collaborationProfile: collaborationProfileEnabled,
    collaborationProfileEnabled,
    orchestratorSubagents: orchestratorSubagentsEnabled,
    orchestratorSubagentsEnabled,
    behaviorSettings
  }
}

export function buildResolvedBehaviorSettings(input: {
  fileBehavior: BehaviorSettings | undefined
  envPersonality: PersonalityOption | undefined
  envThinkingSummaries: boolean | undefined
  envVerbosityEnabled: boolean | undefined
  envVerbosity: VerbosityOption | undefined
}): BehaviorSettings | undefined {
  const behaviorSettings = cloneBehaviorSettings(input.fileBehavior) ?? {}
  const globalBehavior: ModelBehaviorOverride = {
    ...(behaviorSettings.global ?? {})
  }

  if (input.envPersonality) {
    globalBehavior.personality = input.envPersonality
  }
  if (input.envThinkingSummaries !== undefined) {
    globalBehavior.thinkingSummaries = input.envThinkingSummaries
  }
  if (input.envVerbosityEnabled !== undefined) {
    globalBehavior.verbosityEnabled = input.envVerbosityEnabled
  }
  if (input.envVerbosity) {
    globalBehavior.verbosity = input.envVerbosity
  }

  if (
    globalBehavior.personality !== undefined ||
    globalBehavior.thinkingSummaries !== undefined ||
    globalBehavior.verbosityEnabled !== undefined ||
    globalBehavior.verbosity !== undefined
  ) {
    behaviorSettings.global = globalBehavior
  }

  return behaviorSettings.global !== undefined || behaviorSettings.perModel !== undefined ? behaviorSettings : undefined
}
