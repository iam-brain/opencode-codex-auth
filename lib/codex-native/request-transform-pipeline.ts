import type { BehaviorSettings, CodexSpoofMode, PersonalityOption } from "../config.js"
import type { CodexModelInfo } from "../model-catalog.js"
import { applyCatalogInstructionOverrideToRequest, type ServiceTierTransformResult } from "./request-transform.js"

export type RequestTransformPipelineResult = {
  request: Request
  instructionOverride: Awaited<ReturnType<typeof applyCatalogInstructionOverrideToRequest>>
  serviceTierOverride: ServiceTierTransformResult
  developerRoleRemap: {
    request: Request
    changed: boolean
    reason: string
    remappedCount: number
    preservedCount: number
  }
  subagentHeader?: string
  isSubagentRequest: boolean
}

export async function applyRequestTransformPipeline(input: {
  request: Request
  spoofMode: CodexSpoofMode
  remapDeveloperMessagesToUserEnabled: boolean
  catalogModels: CodexModelInfo[] | undefined
  behaviorSettings?: BehaviorSettings
  fallbackPersonality?: PersonalityOption
  preserveOrchestratorInstructions?: boolean
  replaceCodexToolCalls?: boolean
}): Promise<RequestTransformPipelineResult> {
  const instructionOverride = await applyCatalogInstructionOverrideToRequest({
    request: input.request,
    enabled: true,
    catalogModels: input.catalogModels,
    behaviorSettings: input.behaviorSettings,
    fallbackPersonality: input.fallbackPersonality,
    replaceExistingInstructions: input.spoofMode === "codex",
    preserveOrchestratorInstructions: input.preserveOrchestratorInstructions,
    replaceCodexToolCalls: input.replaceCodexToolCalls
  })
  const request = instructionOverride.request
  const serviceTierOverride: ServiceTierTransformResult = {
    request,
    changed: false,
    reason: "deferred_to_payload_transform"
  }
  const developerRoleRemap = {
    request,
    changed: false,
    reason: input.remapDeveloperMessagesToUserEnabled ? "deferred_to_payload_transform" : "disabled",
    remappedCount: 0,
    preservedCount: 0
  }
  const subagentHeader = request.headers.get("x-openai-subagent")?.trim()

  return {
    request,
    instructionOverride,
    serviceTierOverride,
    developerRoleRemap,
    subagentHeader: subagentHeader || undefined,
    isSubagentRequest: Boolean(subagentHeader)
  }
}
