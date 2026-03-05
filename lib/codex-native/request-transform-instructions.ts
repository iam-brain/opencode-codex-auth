import type { BehaviorSettings, PersonalityOption } from "../config.js"
import type { CodexModelInfo } from "../model-catalog.js"
import { resolveInstructionsForModel } from "../model-catalog.js"
import { isRecord } from "../util.js"
import { isOrchestratorInstructions, replaceCodexToolCallsForOpenCode } from "./collaboration.js"
import {
  findCatalogModelForCandidates,
  getModelLookupCandidates,
  resolvePersonalityForModel
} from "./request-transform-model.js"
import { getRequestBodyVariantCandidates } from "./request-transform-model-service-tier.js"
import { rebuildRequestWithJsonBody } from "./request-transform-payload-helpers.js"
import { asString } from "./request-transform-shared.js"

const COLLABORATION_INSTRUCTION_MARKERS = [
  "# Plan Mode",
  "# Plan Mode (Conversational)",
  "# Sub-agents",
  "# Tooling Compatibility ("
]

function extractCollaborationInstructionTail(instructions: string): string | undefined {
  const normalized = instructions.trim()
  if (!normalized) return undefined

  let markerIndex: number | undefined
  for (const marker of COLLABORATION_INSTRUCTION_MARKERS) {
    const index = normalized.indexOf(marker)
    if (index < 0) continue
    if (markerIndex === undefined || index < markerIndex) markerIndex = index
  }

  if (markerIndex === undefined) return undefined
  const tail = normalized.slice(markerIndex).trim()
  return tail.length > 0 ? tail : undefined
}

export async function applyCatalogInstructionOverrideToRequest(input: {
  request: Request
  enabled: boolean
  catalogModels: CodexModelInfo[] | undefined
  behaviorSettings: BehaviorSettings | undefined
  fallbackPersonality: PersonalityOption | undefined
  preserveOrchestratorInstructions?: boolean
  replaceCodexToolCalls?: boolean
}): Promise<{ request: Request; changed: boolean; reason: string }> {
  if (!input.enabled) return { request: input.request, changed: false, reason: "disabled" }

  const method = input.request.method.toUpperCase()
  if (method !== "POST") return { request: input.request, changed: false, reason: "non_post" }

  let payload: unknown
  try {
    const raw = await input.request.clone().text()
    if (!raw) return { request: input.request, changed: false, reason: "empty_body" }
    payload = JSON.parse(raw)
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      // request body could not be parsed as JSON
    }
    return { request: input.request, changed: false, reason: "invalid_json" }
  }

  if (!isRecord(payload)) return { request: input.request, changed: false, reason: "non_object_body" }
  const modelSlugRaw = asString(payload.model)
  if (!modelSlugRaw) return { request: input.request, changed: false, reason: "missing_model" }

  const modelCandidates = getModelLookupCandidates({
    id: modelSlugRaw,
    api: { id: modelSlugRaw }
  })
  const variantCandidates = getRequestBodyVariantCandidates({
    body: payload,
    modelSlug: modelSlugRaw
  })
  const effectivePersonality = resolvePersonalityForModel({
    behaviorSettings: input.behaviorSettings,
    modelCandidates,
    variantCandidates,
    fallback: input.fallbackPersonality
  })
  const catalogModel = findCatalogModelForCandidates(input.catalogModels, modelCandidates)
  if (!catalogModel) return { request: input.request, changed: false, reason: "catalog_model_not_found" }

  const rendered = resolveInstructionsForModel(catalogModel, effectivePersonality)
  if (!rendered) return { request: input.request, changed: false, reason: "rendered_empty_or_unsafe" }
  const renderedForRequest =
    input.replaceCodexToolCalls === true ? (replaceCodexToolCallsForOpenCode(rendered) ?? rendered) : rendered

  const currentInstructions = asString(payload.instructions)

  const preserveOrchestratorInstructions = input.preserveOrchestratorInstructions !== false
  if (preserveOrchestratorInstructions && isOrchestratorInstructions(currentInstructions)) {
    return { request: input.request, changed: false, reason: "orchestrator_instructions_preserved" }
  }

  if (currentInstructions === renderedForRequest) {
    return { request: input.request, changed: false, reason: "already_matches" }
  }

  const collaborationTail = currentInstructions ? extractCollaborationInstructionTail(currentInstructions) : undefined
  const preservedInstructions = collaborationTail ?? currentInstructions?.trim()
  const nextInstructions = preservedInstructions
    ? `${renderedForRequest}\n\n${preservedInstructions}`
    : renderedForRequest

  if (currentInstructions === nextInstructions) {
    return { request: input.request, changed: false, reason: "already_matches" }
  }

  payload.instructions = nextInstructions
  const updatedRequest = rebuildRequestWithJsonBody(input.request, payload)
  return { request: updatedRequest, changed: true, reason: "updated" }
}
