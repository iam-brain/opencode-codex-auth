import { getModelLookupCandidates } from "./request-transform-model.js"
import { asString } from "./request-transform-shared.js"

const GPT_5_4_MAX_CONTEXT_WINDOW = 1_050_000
const GPT_5_4_MAX_OUTPUT_TOKENS = 128_000
const GPT_5_4_MAX_PRACTICAL_INPUT_TOKENS = GPT_5_4_MAX_CONTEXT_WINDOW - GPT_5_4_MAX_OUTPUT_TOKENS

export function applyGpt54LongContextClampsToPayload(payload: Record<string, unknown>): boolean {
  const modelSlug = asString(payload.model)
  if (!modelSlug) return false

  const modelCandidates = getModelLookupCandidates({
    id: modelSlug,
    api: { id: modelSlug }
  })
  const isGpt54 = modelCandidates.some((candidate) => candidate.trim().toLowerCase().startsWith("gpt-5.4"))
  if (!isGpt54) return false

  let changed = false

  const contextWindow = asFiniteNumber(payload.model_context_window)
  if (contextWindow !== undefined && contextWindow > GPT_5_4_MAX_CONTEXT_WINDOW) {
    payload.model_context_window = GPT_5_4_MAX_CONTEXT_WINDOW
    changed = true
  }

  const effectiveContextWindowMax = Math.min(
    GPT_5_4_MAX_CONTEXT_WINDOW,
    asFiniteNumber(payload.model_context_window) ?? GPT_5_4_MAX_CONTEXT_WINDOW
  )
  const autoCompactMax = Math.max(
    0,
    Math.min(GPT_5_4_MAX_PRACTICAL_INPUT_TOKENS, effectiveContextWindowMax - GPT_5_4_MAX_OUTPUT_TOKENS)
  )
  const autoCompact = asFiniteNumber(payload.model_auto_compact_token_limit)
  if (autoCompact !== undefined && autoCompact > autoCompactMax) {
    payload.model_auto_compact_token_limit = autoCompactMax
    changed = true
  }

  const maxOutputTokens = asFiniteNumber(payload.max_output_tokens)
  if (maxOutputTokens !== undefined && maxOutputTokens > GPT_5_4_MAX_OUTPUT_TOKENS) {
    payload.max_output_tokens = GPT_5_4_MAX_OUTPUT_TOKENS
    changed = true
  }

  return changed
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}
