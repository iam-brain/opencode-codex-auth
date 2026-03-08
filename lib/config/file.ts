import fs from "node:fs"
import fsPromises from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { isRecord } from "../util.js"
import type { RotationStrategy } from "../types.js"
import {
  CONFIG_FILE,
  DEFAULT_CODEX_CONFIG_TEMPLATE,
  LEGACY_CONFIG_FILE,
  type BehaviorSettings,
  type CustomModelConfig,
  type IncludeOption,
  type ModelConfigOverride,
  type PersonalityOption,
  type PluginConfig,
  type PluginRuntimeMode,
  type PromptCacheKeyStrategy,
  type ReasoningSummaryOption,
  type ServiceTierOption,
  type TextVerbosityOption,
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
  reasoningEffort?: string
  reasoningSummary?: ReasoningSummaryOption
  reasoningSummaries?: boolean
  verbosityEnabled?: boolean
  verbosity?: VerbosityOption
  textVerbosity?: TextVerbosityOption
  serviceTier?: ServiceTierOption
  include?: IncludeOption[]
  parallelToolCalls?: boolean
}

type ParsedConfigFile = {
  config: Partial<PluginConfig>
  deprecatedKeys: string[]
}

function describeValueType(value: unknown): string {
  if (Array.isArray(value)) return "array"
  if (value === null) return "null"
  return typeof value
}

function describeValuePreview(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
    return String(value)
  }
  if (Array.isArray(value)) {
    return `array(${value.length})`
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>)
    return keys.length > 0 ? `object(${keys.slice(0, 3).join(", ")})` : "object"
  }
  return String(value)
}

function pushValidationIssue(
  issues: string[],
  input: {
    path: string
    expected: string
    actual: unknown
  }
): void {
  issues.push(
    `${input.path}: expected ${input.expected}, found ${describeValueType(input.actual)} (${describeValuePreview(input.actual)})`
  )
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

const SUPPORTED_INCLUDE_OPTIONS = [
  "reasoning.encrypted_content",
  "file_search_call.results",
  "message.output_text.logprobs"
] as const satisfies readonly IncludeOption[]

type NormalizedServiceTierInput = {
  value?: ServiceTierOption
  usedDeprecatedDefaultAlias: boolean
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function deriveReasoningSummaryAlias(value: ReasoningSummaryOption | undefined): boolean | undefined {
  if (value === undefined) return undefined
  return value !== "none"
}

function deriveVerbosityEnabledAlias(value: TextVerbosityOption | undefined): boolean | undefined {
  if (value === undefined) return undefined
  return value !== "none"
}

function deriveVerbosityAlias(value: TextVerbosityOption | undefined): VerbosityOption | undefined {
  if (value === undefined || value === "none") return undefined
  return value
}

function normalizeReasoningSummaryOption(value: unknown): ReasoningSummaryOption | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "auto" || normalized === "concise" || normalized === "detailed" || normalized === "none") {
    return normalized
  }
  return undefined
}

export function normalizeTextVerbosityOption(value: unknown): TextVerbosityOption | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (
    normalized === "default" ||
    normalized === "low" ||
    normalized === "medium" ||
    normalized === "high" ||
    normalized === "none"
  ) {
    return normalized
  }
  return undefined
}

function normalizeIncludeOptions(value: unknown): IncludeOption[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: IncludeOption[] = []
  const seen = new Set<IncludeOption>()
  for (const entry of value) {
    if (typeof entry !== "string") continue
    const normalized = entry.trim().toLowerCase() as IncludeOption
    if (!SUPPORTED_INCLUDE_OPTIONS.includes(normalized)) continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out.length > 0 ? out : undefined
}

function normalizeServiceTierInput(value: unknown): NormalizedServiceTierInput {
  if (typeof value !== "string") {
    return { value: undefined, usedDeprecatedDefaultAlias: false }
  }
  const normalized = value.trim().toLowerCase()
  if (normalized === "default") {
    return { value: "auto", usedDeprecatedDefaultAlias: true }
  }
  if (normalized === "auto" || normalized === "priority" || normalized === "flex") {
    return { value: normalized, usedDeprecatedDefaultAlias: false }
  }
  return { value: undefined, usedDeprecatedDefaultAlias: false }
}

function normalizeModelBehaviorSettings(raw: unknown): ModelBehaviorSettings | undefined {
  if (!isRecord(raw)) return undefined
  const out: ModelBehaviorSettings = {}

  const personality = normalizePersonalityOption(raw.personality)
  if (personality) out.personality = personality

  const reasoningEffort = normalizeNonEmptyString(raw.reasoningEffort)
  if (reasoningEffort) out.reasoningEffort = reasoningEffort

  const reasoningSummary = normalizeReasoningSummaryOption(raw.reasoningSummary)
  if (reasoningSummary) {
    out.reasoningSummary = reasoningSummary
  } else if (typeof raw.reasoningSummaries === "boolean") {
    out.reasoningSummary = raw.reasoningSummaries ? "auto" : "none"
  } else if (typeof raw.thinkingSummaries === "boolean") {
    out.reasoningSummary = raw.thinkingSummaries ? "auto" : "none"
  }
  out.reasoningSummaries = deriveReasoningSummaryAlias(out.reasoningSummary)

  const textVerbosity = normalizeTextVerbosityOption(raw.textVerbosity)
  if (textVerbosity) {
    out.textVerbosity = textVerbosity
  } else {
    const verbosityEnabled = typeof raw.verbosityEnabled === "boolean" ? raw.verbosityEnabled : undefined
    const verbosity = normalizeVerbosityOption(raw.verbosity)
    if (verbosityEnabled === false) {
      out.textVerbosity = "none"
    } else if (verbosity) {
      out.textVerbosity = verbosity
    } else if (verbosityEnabled === true) {
      out.textVerbosity = "default"
    }
  }
  out.verbosityEnabled = deriveVerbosityEnabledAlias(out.textVerbosity)
  out.verbosity = deriveVerbosityAlias(out.textVerbosity)

  const serviceTier = normalizeServiceTierInput(raw.serviceTier)
  if (serviceTier.value) out.serviceTier = serviceTier.value

  const include = normalizeIncludeOptions(raw.include)
  if (include) out.include = include

  if (typeof raw.parallelToolCalls === "boolean") {
    out.parallelToolCalls = raw.parallelToolCalls
  }

  if (
    !out.personality &&
    !out.reasoningEffort &&
    out.reasoningSummary === undefined &&
    out.reasoningSummaries === undefined &&
    out.textVerbosity === undefined &&
    out.verbosityEnabled === undefined &&
    out.verbosity === undefined &&
    out.serviceTier === undefined &&
    out.include === undefined &&
    out.parallelToolCalls === undefined
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
        ...(normalized.reasoningEffort ? { reasoningEffort: normalized.reasoningEffort } : {}),
        ...(normalized.reasoningSummary ? { reasoningSummary: normalized.reasoningSummary } : {}),
        ...(normalized.reasoningSummaries !== undefined ? { reasoningSummaries: normalized.reasoningSummaries } : {}),
        ...(normalized.textVerbosity ? { textVerbosity: normalized.textVerbosity } : {}),
        ...(normalized.verbosityEnabled !== undefined ? { verbosityEnabled: normalized.verbosityEnabled } : {}),
        ...(normalized.verbosity ? { verbosity: normalized.verbosity } : {}),
        ...(normalized.serviceTier ? { serviceTier: normalized.serviceTier } : {}),
        ...(normalized.include ? { include: normalized.include } : {}),
        ...(normalized.parallelToolCalls !== undefined ? { parallelToolCalls: normalized.parallelToolCalls } : {})
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
    ...(modelBehavior?.reasoningEffort ? { reasoningEffort: modelBehavior.reasoningEffort } : {}),
    ...(modelBehavior?.reasoningSummary ? { reasoningSummary: modelBehavior.reasoningSummary } : {}),
    ...(modelBehavior?.reasoningSummaries !== undefined
      ? { reasoningSummaries: modelBehavior.reasoningSummaries }
      : {}),
    ...(modelBehavior?.textVerbosity ? { textVerbosity: modelBehavior.textVerbosity } : {}),
    ...(modelBehavior?.verbosityEnabled !== undefined ? { verbosityEnabled: modelBehavior.verbosityEnabled } : {}),
    ...(modelBehavior?.verbosity ? { verbosity: modelBehavior.verbosity } : {}),
    ...(modelBehavior?.serviceTier ? { serviceTier: modelBehavior.serviceTier } : {}),
    ...(modelBehavior?.include ? { include: modelBehavior.include } : {}),
    ...(modelBehavior?.parallelToolCalls !== undefined ? { parallelToolCalls: modelBehavior.parallelToolCalls } : {}),
    ...(variants ? { variants } : {})
  }
}

function normalizeCustomModelConfig(raw: unknown): CustomModelConfig | undefined {
  if (!isRecord(raw)) return undefined
  const behavior = normalizeModelConfigOverride(raw)
  const targetModel = normalizeNonEmptyString(raw.targetModel)
  const name = normalizeNonEmptyString(raw.name)
  if (!targetModel && !behavior && !name) return undefined
  if (!targetModel) return undefined

  return {
    targetModel,
    ...(name ? { name } : {}),
    ...(behavior ?? {})
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

function normalizeCustomModels(raw: Record<string, unknown>): Record<string, CustomModelConfig> | undefined {
  const customModelsRaw = isRecord(raw.customModels) ? raw.customModels : undefined
  if (!customModelsRaw) return undefined

  const out: Record<string, CustomModelConfig> = {}
  for (const [slug, value] of Object.entries(customModelsRaw)) {
    const normalizedSlug = normalizeNonEmptyString(slug)?.toLowerCase()
    if (!normalizedSlug) continue
    const normalized = normalizeCustomModelConfig(value)
    if (!normalized) continue
    out[normalizedSlug] = normalized
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function validateModelBehaviorShape(value: unknown, pathPrefix: string, issues: string[]): void {
  if (!isRecord(value)) {
    pushValidationIssue(issues, { path: pathPrefix, expected: "object", actual: value })
    return
  }

  if ("personality" in value && typeof value.personality !== "string") {
    pushValidationIssue(issues, { path: `${pathPrefix}.personality`, expected: "string", actual: value.personality })
  }
  if ("reasoningEffort" in value && typeof value.reasoningEffort !== "string") {
    pushValidationIssue(issues, {
      path: `${pathPrefix}.reasoningEffort`,
      expected: "string",
      actual: value.reasoningEffort
    })
  }
  if ("reasoningSummary" in value) {
    const reasoningSummary = value.reasoningSummary
    const normalized = typeof reasoningSummary === "string" ? reasoningSummary.trim().toLowerCase() : ""
    if (!(normalized === "auto" || normalized === "concise" || normalized === "detailed" || normalized === "none")) {
      pushValidationIssue(issues, {
        path: `${pathPrefix}.reasoningSummary`,
        expected: '"auto" | "concise" | "detailed" | "none"',
        actual: reasoningSummary
      })
    }
  }
  if ("reasoningSummaries" in value && typeof value.reasoningSummaries !== "boolean") {
    pushValidationIssue(issues, {
      path: `${pathPrefix}.reasoningSummaries`,
      expected: "boolean",
      actual: value.reasoningSummaries
    })
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
  if ("textVerbosity" in value) {
    const textVerbosity = value.textVerbosity
    const normalized = typeof textVerbosity === "string" ? textVerbosity.trim().toLowerCase() : ""
    if (
      !(
        normalized === "default" ||
        normalized === "low" ||
        normalized === "medium" ||
        normalized === "high" ||
        normalized === "none"
      )
    ) {
      pushValidationIssue(issues, {
        path: `${pathPrefix}.textVerbosity`,
        expected: '"default" | "low" | "medium" | "high" | "none"',
        actual: textVerbosity
      })
    }
  }
  if ("serviceTier" in value) {
    const serviceTier = value.serviceTier
    const normalized = typeof serviceTier === "string" ? serviceTier.trim().toLowerCase() : ""
    if (!(normalized === "default" || normalized === "auto" || normalized === "priority" || normalized === "flex")) {
      pushValidationIssue(issues, {
        path: `${pathPrefix}.serviceTier`,
        expected: '"auto" | "priority" | "flex" (deprecated alias: "default")',
        actual: serviceTier
      })
    }
  }
  if ("include" in value) {
    if (!Array.isArray(value.include)) {
      pushValidationIssue(issues, {
        path: `${pathPrefix}.include`,
        expected: "array",
        actual: value.include
      })
    } else {
      for (const entry of value.include) {
        const normalized = typeof entry === "string" ? entry.trim().toLowerCase() : ""
        if (!SUPPORTED_INCLUDE_OPTIONS.includes(normalized as IncludeOption)) {
          pushValidationIssue(issues, {
            path: `${pathPrefix}.include`,
            expected: SUPPORTED_INCLUDE_OPTIONS.map((item) => `"${item}"`).join(" | "),
            actual: entry
          })
        }
      }
    }
  }
  if ("parallelToolCalls" in value && typeof value.parallelToolCalls !== "boolean") {
    pushValidationIssue(issues, {
      path: `${pathPrefix}.parallelToolCalls`,
      expected: "boolean",
      actual: value.parallelToolCalls
    })
  }
}

function validateCustomModelShape(value: unknown, pathPrefix: string, issues: string[]): void {
  validateModelBehaviorShape(value, pathPrefix, issues)
  if (!isRecord(value)) return
  if ("targetModel" in value && typeof value.targetModel !== "string") {
    pushValidationIssue(issues, {
      path: `${pathPrefix}.targetModel`,
      expected: "string",
      actual: value.targetModel
    })
  }
  if (!("targetModel" in value)) {
    issues.push(`${pathPrefix}.targetModel: expected string, found missing (custom models require targetModel)`)
  }
  if ("name" in value && typeof value.name !== "string") {
    pushValidationIssue(issues, {
      path: `${pathPrefix}.name`,
      expected: "string",
      actual: value.name
    })
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
  return normalizeServiceTierInput(value).value
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

  if ("customModels" in raw) {
    if (!isRecord(raw.customModels)) {
      pushValidationIssue(issues, { path: "customModels", expected: "object", actual: raw.customModels })
    } else {
      for (const [slug, value] of Object.entries(raw.customModels)) {
        validateCustomModelShape(value, `customModels.${slug}`, issues)
        if (!isRecord(value) || !("variants" in value)) continue
        const variants = value.variants
        if (!isRecord(variants)) {
          pushValidationIssue(issues, {
            path: `customModels.${slug}.variants`,
            expected: "object",
            actual: variants
          })
          continue
        }
        for (const [variantName, variantValue] of Object.entries(variants)) {
          validateModelBehaviorShape(variantValue, `customModels.${slug}.variants.${variantName}`, issues)
        }
      }
    }
  }

  return { valid: issues.length === 0, issues }
}

export function parseConfigFileObject(raw: unknown): Partial<PluginConfig> {
  return parseConfigFileObjectWithMetadata(raw).config
}

function collectDeprecatedModelBehaviorKeys(raw: unknown): string[] {
  if (!isRecord(raw)) return []

  const keys: string[] = []
  const collectBehaviorAlias = (value: unknown, pathPrefix: string) => {
    if (!isRecord(value)) return
    if (typeof value.reasoningSummaries === "boolean") {
      keys.push(`${pathPrefix}.reasoningSummaries`)
    }
    if (typeof value.thinkingSummaries === "boolean") {
      keys.push(`${pathPrefix}.thinkingSummaries`)
    }
    if ("verbosityEnabled" in value) {
      keys.push(`${pathPrefix}.verbosityEnabled`)
    }
    if ("verbosity" in value) {
      keys.push(`${pathPrefix}.verbosity`)
    }
    if (typeof value.serviceTier === "string" && value.serviceTier.trim().toLowerCase() === "default") {
      keys.push(`${pathPrefix}.serviceTier="default"`)
    }
  }

  collectBehaviorAlias(raw.global, "global")

  if (isRecord(raw.perModel)) {
    for (const [modelName, modelValue] of Object.entries(raw.perModel)) {
      collectBehaviorAlias(modelValue, `perModel.${modelName}`)

      if (!isRecord(modelValue)) continue
      const variants = isRecord(modelValue.variants) ? modelValue.variants : undefined
      if (!variants) continue
      for (const [variantName, variantValue] of Object.entries(variants)) {
        collectBehaviorAlias(variantValue, `perModel.${modelName}.variants.${variantName}`)
      }
    }
  }

  if (isRecord(raw.customModels)) {
    for (const [slug, modelValue] of Object.entries(raw.customModels)) {
      collectBehaviorAlias(modelValue, `customModels.${slug}`)
      if (!isRecord(modelValue)) continue
      const variants = isRecord(modelValue.variants) ? modelValue.variants : undefined
      if (!variants) continue
      for (const [variantName, variantValue] of Object.entries(variants)) {
        collectBehaviorAlias(variantValue, `customModels.${slug}.variants.${variantName}`)
      }
    }
  }

  return keys
}

function parseConfigFileObjectWithMetadata(raw: unknown): ParsedConfigFile {
  if (!isRecord(raw)) {
    return {
      config: {},
      deprecatedKeys: []
    }
  }

  const behaviorSettings = normalizeNewBehaviorSections(raw)
  const customModels = normalizeCustomModels(raw)
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
    config: {
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
      behaviorSettings,
      customModels
    },
    deprecatedKeys: collectDeprecatedModelBehaviorKeys(raw)
  }
}

export function resolveDefaultConfigPath(env: Record<string, string | undefined>): string {
  const xdgRoot = env.XDG_CONFIG_HOME?.trim()
  if (xdgRoot) {
    return path.join(xdgRoot, "opencode", CONFIG_FILE)
  }
  return path.join(os.homedir(), ".config", "opencode", CONFIG_FILE)
}

export function resolveLegacyDefaultConfigPath(env: Record<string, string | undefined>): string {
  const xdgRoot = env.XDG_CONFIG_HOME?.trim()
  if (xdgRoot) {
    return path.join(xdgRoot, "opencode", LEGACY_CONFIG_FILE)
  }
  return path.join(os.homedir(), ".config", "opencode", LEGACY_CONFIG_FILE)
}

function quarantineLegacyConfigSync(filePath: string): string | undefined {
  try {
    const quarantineDir = path.join(path.dirname(filePath), "quarantine")
    fs.mkdirSync(quarantineDir, { recursive: true })
    const dest = path.join(quarantineDir, `${path.basename(filePath)}.${Date.now()}.quarantine.json`)
    fs.renameSync(filePath, dest)
    return dest
  } catch {
    return undefined
  }
}

function resolveDefaultConfigCandidates(env: Record<string, string | undefined>): string[] {
  const filePath = resolveDefaultConfigPath(env)
  const legacyPath = resolveLegacyDefaultConfigPath(env)
  const hasFile = fs.existsSync(filePath)
  const hasLegacy = fs.existsSync(legacyPath)

  if (hasFile && hasLegacy) {
    return [filePath, legacyPath]
  }
  if (hasFile) return [filePath]
  if (hasLegacy) return [legacyPath]
  return [filePath]
}

export async function ensureDefaultConfigFile(
  input: { env?: Record<string, string | undefined>; filePath?: string; overwrite?: boolean } = {}
): Promise<EnsureDefaultConfigFileResult> {
  const env = input.env ?? process.env
  const filePath =
    input.filePath ??
    (() => {
      const canonicalPath = resolveDefaultConfigPath(env)
      const legacyPath = resolveLegacyDefaultConfigPath(env)
      if (fs.existsSync(canonicalPath)) return canonicalPath
      if (fs.existsSync(legacyPath)) return legacyPath
      return canonicalPath
    })()
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
  const candidates = explicitPath ? [explicitPath] : resolveDefaultConfigCandidates(env)
  const canonicalPath = explicitPath ? undefined : resolveDefaultConfigPath(env)
  const legacyPath = explicitPath ? undefined : resolveLegacyDefaultConfigPath(env)
  const shouldQuarantineLegacyAfterCanonicalLoad =
    !explicitPath &&
    canonicalPath !== undefined &&
    legacyPath !== undefined &&
    candidates.length > 1 &&
    fs.existsSync(canonicalPath) &&
    fs.existsSync(legacyPath)

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
      const result = parseConfigFileObjectWithMetadata(parsed)
      if (result.deprecatedKeys.length > 0) {
        console.warn(
          `[opencode-codex-auth] Deprecated config key(s) in ${filePath}: ${result.deprecatedKeys.join(", ")}. Use reasoningSummary, textVerbosity, and serviceTier: "auto" instead.`
        )
      }
      if (
        shouldQuarantineLegacyAfterCanonicalLoad &&
        filePath === canonicalPath &&
        legacyPath &&
        fs.existsSync(legacyPath)
      ) {
        const quarantinedPath = quarantineLegacyConfigSync(legacyPath)
        const suffix = quarantinedPath ? ` Quarantined legacy file to ${quarantinedPath}.` : ""
        console.warn(
          `[opencode-codex-auth] Found both ${CONFIG_FILE} and ${LEGACY_CONFIG_FILE}. Using ${CONFIG_FILE}.${suffix}`
        )
      }
      return result.config
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      console.warn(`[opencode-codex-auth] Failed to read codex-config at ${filePath}. ${detail}`)
    }
  }

  return {}
}
