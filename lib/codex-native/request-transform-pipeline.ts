import type { BehaviorSettings, CodexSpoofMode, PersonalityOption } from "../config"
import type { CodexModelInfo } from "../model-catalog"
import { applyCatalogInstructionOverrideToRequest } from "./request-transform"

export type RequestTransformPipelineResult = {
  request: Request
  instructionOverride: Awaited<ReturnType<typeof applyCatalogInstructionOverrideToRequest>>
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
    enabled: input.spoofMode === "codex",
    catalogModels: input.catalogModels,
    behaviorSettings: input.behaviorSettings,
    fallbackPersonality: input.fallbackPersonality,
    preserveOrchestratorInstructions: input.preserveOrchestratorInstructions,
    replaceCodexToolCalls: input.replaceCodexToolCalls
  })
  const request = instructionOverride.request
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
    developerRoleRemap,
    subagentHeader: subagentHeader || undefined,
    isSubagentRequest: Boolean(subagentHeader)
  }
}
