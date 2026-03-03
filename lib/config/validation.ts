import { isRecord } from "../util.js"

export type ConfigValidationResult = {
  valid: boolean
  issues: string[]
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
