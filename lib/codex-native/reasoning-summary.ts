import { PluginFatalError } from "../fatal-errors.js"
export const SUPPORTED_REASONING_SUMMARY_VALUES = ["auto", "concise", "detailed"] as const

export type ReasoningSummaryValue = (typeof SUPPORTED_REASONING_SUMMARY_VALUES)[number]

export type ReasoningSummaryValidationDiagnostic = {
  actual: string
  model?: string
  source: string
  sourceType: "request_option" | "catalog_default"
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function inspectReasoningSummaryValue(input: unknown): {
  state: "absent" | "disabled" | "valid" | "invalid"
  raw?: string
  value?: ReasoningSummaryValue
} {
  const raw = asString(input)
  const normalized = raw?.toLowerCase()
  if (!normalized) return { state: "absent" }
  if (normalized === "none") return { state: "disabled", raw }
  if (
    normalized === SUPPORTED_REASONING_SUMMARY_VALUES[0] ||
    normalized === SUPPORTED_REASONING_SUMMARY_VALUES[1] ||
    normalized === SUPPORTED_REASONING_SUMMARY_VALUES[2]
  ) {
    return { state: "valid", raw, value: normalized }
  }
  return { state: "invalid", raw }
}

export function resolveReasoningSummaryValue(input: {
  explicitValue?: unknown
  explicitSource: string
  hasReasoning: boolean
  configuredValue?: unknown
  configuredSource?: string
  supportsReasoningSummaries?: boolean
  defaultReasoningSummaryFormat?: string
  defaultReasoningSummarySource: string
  model?: string
}): { value?: ReasoningSummaryValue; diagnostic?: ReasoningSummaryValidationDiagnostic } {
  const explicit = inspectReasoningSummaryValue(input.explicitValue)
  if (explicit.state === "invalid" && explicit.raw) {
    return {
      diagnostic: {
        actual: explicit.raw,
        source: input.explicitSource,
        sourceType: "request_option"
      }
    }
  }
  if (explicit.state === "valid") {
    return { value: explicit.value }
  }
  if (explicit.state === "disabled") {
    return {}
  }

  if (!input.hasReasoning) {
    return {}
  }

  const configured = inspectReasoningSummaryValue(input.configuredValue)
  if (configured.state === "invalid" && configured.raw) {
    return {
      diagnostic: {
        actual: configured.raw,
        source: input.configuredSource ?? "config.reasoningSummary",
        sourceType: "request_option"
      }
    }
  }
  if (configured.state === "valid") {
    return { value: configured.value }
  }
  if (configured.state === "disabled") {
    return {}
  }

  if (input.supportsReasoningSummaries !== true) {
    return {}
  }

  const defaultValue = inspectReasoningSummaryValue(input.defaultReasoningSummaryFormat)
  if (defaultValue.state === "invalid" && defaultValue.raw) {
    return {
      diagnostic: {
        actual: defaultValue.raw,
        model: input.model,
        source: input.defaultReasoningSummarySource,
        sourceType: "catalog_default"
      }
    }
  }
  if (defaultValue.state === "valid") {
    return { value: defaultValue.value }
  }
  if (defaultValue.state === "disabled") {
    return {}
  }

  return { value: "auto" }
}

export function toReasoningSummaryPluginFatalError(diagnostic: ReasoningSummaryValidationDiagnostic): PluginFatalError {
  const supportedValues = [...SUPPORTED_REASONING_SUMMARY_VALUES, "none"].map((value) => `\`${value}\``).join(", ")
  const subject =
    diagnostic.sourceType === "catalog_default"
      ? `selected model catalog default \`${diagnostic.source}\`${diagnostic.model ? ` for \`${diagnostic.model}\`` : ""}`
      : `request setting \`${diagnostic.source}\``

  const hint =
    diagnostic.sourceType === "catalog_default"
      ? 'This source is internal, not a user config key. Disable summaries with `reasoningSummary: "none"` if you need a workaround.'
      : "Update the request to a supported reasoning summary value."

  return new PluginFatalError({
    message: `Invalid reasoning summary setting source: ${subject} is \`${diagnostic.actual}\`. Supported values are ${supportedValues}.`,
    status: 400,
    type: "invalid_reasoning_summary",
    param: "reasoning.summary",
    source: diagnostic.source,
    hint
  })
}
