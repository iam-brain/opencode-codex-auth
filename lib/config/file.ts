import fs from "node:fs"
import fsPromises from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { isRecord } from "../util.js"
import type { RotationStrategy } from "../types.js"
import {
  CONFIG_FILE,
  DEFAULT_CODEX_CONFIG_TEMPLATE,
  type BehaviorSettings,
  type ModelConfigOverride,
  type PersonalityOption,
  type PluginConfig,
  type PluginRuntimeMode,
  type PromptCacheKeyStrategy,
  type ServiceTierOption,
  type VerbosityOption
} from "./types.js"

export type ConfigValidationResult = {
  valid: boolean
  issues: string[]
}

export type EnsureDefaultConfigFileResult = {
  filePath: string
  created: boolean
}

type ModelBehaviorSettings = {
  personality?: PersonalityOption
  thinkingSummaries?: boolean
  verbosityEnabled?: boolean
  verbosity?: VerbosityOption
  serviceTier?: ServiceTierOption
}

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

function normalizeModelBehaviorSettings(raw: unknown): ModelBehaviorSettings | undefined {
  if (!isRecord(raw)) return undefined
  const out: ModelBehaviorSettings = {}

  const personality = normalizePersonalityOption(raw.personality)
  if (personality) out.personality = personality

  if (typeof raw.thinkingSummaries === "boolean") out.thinkingSummaries = raw.thinkingSummaries
  if (typeof raw.verbosityEnabled === "boolean") out.verbosityEnabled = raw.verbosityEnabled

  const verbosity = normalizeVerbosityOption(raw.verbosity)
  if (verbosity) out.verbosity = verbosity

  const serviceTier = normalizeServiceTierOption(raw.serviceTier)
  if (serviceTier) out.serviceTier = serviceTier

  if (
    !out.personality &&
    out.thinkingSummaries === undefined &&
    out.verbosityEnabled === undefined &&
    out.verbosity === undefined &&
    out.serviceTier === undefined
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
        ...(normalized.verbosity ? { verbosity: normalized.verbosity } : {}),
        ...(normalized.serviceTier ? { serviceTier: normalized.serviceTier } : {})
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
    ...(modelBehavior?.serviceTier ? { serviceTier: modelBehavior.serviceTier } : {}),
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

  if (!global && !perModel) return undefined

  return {
    ...(global ? { global } : {}),
    ...(perModel ? { perModel } : {})
  }
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
  if ("serviceTier" in value) {
    const serviceTier = value.serviceTier
    const normalized = typeof serviceTier === "string" ? serviceTier.trim().toLowerCase() : ""
    if (!(normalized === "default" || normalized === "priority" || normalized === "flex")) {
      pushValidationIssue(issues, {
        path: `${pathPrefix}.serviceTier`,
        expected: '"default" | "priority" | "flex"',
        actual: serviceTier
      })
    }
  }
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

export function parseSpoofMode(value: unknown): PluginRuntimeMode | undefined {
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

export function normalizeServiceTierOption(value: unknown): ServiceTierOption | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "default" || normalized === "priority" || normalized === "flex") {
    return normalized
  }
  return undefined
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
        { field: "promptCacheKeyStrategy", allowed: ["default", "project"] }
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
        if (!isRecord(modelValue) || !("variants" in modelValue)) continue

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

export function parseConfigFileObject(raw: unknown): Partial<PluginConfig> {
  if (!isRecord(raw)) return {}

  const behaviorSettings = normalizeNewBehaviorSections(raw)
  const personalityFromBehavior = behaviorSettings?.global?.personality
  const runtime = isRecord(raw.runtime) ? raw.runtime : undefined

  const debug = typeof raw.debug === "boolean" ? raw.debug : undefined
  const proactiveRefresh =
    isRecord(raw.refreshAhead) && typeof raw.refreshAhead.enabled === "boolean" ? raw.refreshAhead.enabled : undefined
  const proactiveRefreshBufferMs =
    isRecord(raw.refreshAhead) && typeof raw.refreshAhead.bufferMs === "number" ? raw.refreshAhead.bufferMs : undefined
  const quietMode = typeof raw.quiet === "boolean" ? raw.quiet : undefined
  const mode = parseRuntimeMode(runtime?.mode)
  const rotationStrategy = parseRotationStrategy(runtime?.rotationStrategy)
  const promptCacheKeyStrategy = parsePromptCacheKeyStrategy(runtime?.promptCacheKeyStrategy)
  const spoofMode = mode === "native" ? "native" : mode === "codex" ? "codex" : undefined
  const compatInputSanitizer = typeof runtime?.sanitizeInputs === "boolean" ? runtime.sanitizeInputs : undefined
  const remapDeveloperMessagesToUser =
    typeof runtime?.developerMessagesToUser === "boolean" ? runtime.developerMessagesToUser : undefined
  const codexCompactionOverride =
    typeof runtime?.codexCompactionOverride === "boolean" ? runtime.codexCompactionOverride : undefined
  const headerSnapshots = typeof runtime?.headerSnapshots === "boolean" ? runtime.headerSnapshots : undefined
  const headerSnapshotBodies =
    typeof runtime?.headerSnapshotBodies === "boolean" ? runtime.headerSnapshotBodies : undefined
  const headerTransformDebug =
    typeof runtime?.headerTransformDebug === "boolean" ? runtime.headerTransformDebug : undefined
  const pidOffsetEnabled = typeof runtime?.pidOffset === "boolean" ? runtime.pidOffset : undefined
  const collaborationProfileEnabled =
    typeof runtime?.collaborationProfile === "boolean" ? runtime.collaborationProfile : undefined
  const orchestratorSubagentsEnabled =
    typeof runtime?.orchestratorSubagents === "boolean" ? runtime.orchestratorSubagents : undefined

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

export function resolveDefaultConfigPath(env: Record<string, string | undefined>): string {
  const xdgRoot = env.XDG_CONFIG_HOME?.trim()
  if (xdgRoot) {
    return path.join(xdgRoot, "opencode", CONFIG_FILE)
  }
  return path.join(os.homedir(), ".config", "opencode", CONFIG_FILE)
}

export async function ensureDefaultConfigFile(
  input: { env?: Record<string, string | undefined>; filePath?: string; overwrite?: boolean } = {}
): Promise<EnsureDefaultConfigFileResult> {
  const env = input.env ?? process.env
  const filePath = input.filePath ?? resolveDefaultConfigPath(env)
  const overwrite = input.overwrite === true

  if (!overwrite && fs.existsSync(filePath)) {
    return { filePath, created: false }
  }

  await fsPromises.mkdir(path.dirname(filePath), { recursive: true })
  await fsPromises.writeFile(filePath, DEFAULT_CODEX_CONFIG_TEMPLATE, { encoding: "utf8", mode: 0o600 })
  try {
    await fsPromises.chmod(filePath, 0o600)
  } catch (error) {
    if (error instanceof Error) {
      // best-effort permission hardening
    }
  }
  return { filePath, created: true }
}

export function loadConfigFile(
  input: { env?: Record<string, string | undefined>; filePath?: string } = {}
): Partial<PluginConfig> {
  const env = input.env ?? process.env
  const explicitPath = input.filePath ?? env.OPENCODE_OPENAI_MULTI_CONFIG_PATH?.trim()
  const candidates = explicitPath ? [explicitPath] : [resolveDefaultConfigPath(env)]

  for (const filePath of candidates) {
    if (!filePath || !fs.existsSync(filePath)) continue
    try {
      const raw = fs.readFileSync(filePath, "utf8")
      const parsed = parseConfigJsonWithComments(raw)
      const validation = validateConfigFileObject(parsed)
      if (!validation.valid) {
        console.warn(`[opencode-codex-auth] Invalid codex-config at ${filePath}. ${validation.issues.join("; ")}`)
        continue
      }
      return parseConfigFileObject(parsed)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.warn(`[opencode-codex-auth] Failed to read codex-config at ${filePath}. ${detail}`)
    }
  }

  return {}
}
