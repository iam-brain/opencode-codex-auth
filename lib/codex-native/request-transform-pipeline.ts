import type { BehaviorSettings, CodexSpoofMode, PersonalityOption } from "../config"
import type { CodexModelInfo } from "../model-catalog"
import { applyCatalogInstructionOverrideToRequest, remapDeveloperMessagesToUserOnRequest } from "./request-transform"

export type RequestTransformPipelineResult = {
  request: Request
  instructionOverride: Awaited<ReturnType<typeof applyCatalogInstructionOverrideToRequest>>
  developerRoleRemap: Awaited<ReturnType<typeof remapDeveloperMessagesToUserOnRequest>>
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
}): Promise<RequestTransformPipelineResult> {
  const instructionOverride = await applyCatalogInstructionOverrideToRequest({
    request: input.request,
    enabled: input.spoofMode === "codex",
    catalogModels: input.catalogModels,
    behaviorSettings: input.behaviorSettings,
    fallbackPersonality: input.fallbackPersonality,
    preserveOrchestratorInstructions: input.preserveOrchestratorInstructions
  })
  const developerRoleRemap = await remapDeveloperMessagesToUserOnRequest({
    request: instructionOverride.request,
    enabled: input.remapDeveloperMessagesToUserEnabled
  })
  const request = developerRoleRemap.request
  const subagentHeader = request.headers.get("x-openai-subagent")?.trim()

  return {
    request,
    instructionOverride,
    developerRoleRemap,
    subagentHeader: subagentHeader || undefined,
    isSubagentRequest: Boolean(subagentHeader)
  }
}
