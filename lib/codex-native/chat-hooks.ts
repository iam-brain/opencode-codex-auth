import type { PluginInput } from "@opencode-ai/plugin"

import type { BehaviorSettings, CodexSpoofMode, PersonalityOption } from "../config"
import type { CodexModelInfo } from "../model-catalog"
import { getRuntimeDefaultsForModel, resolveInstructionsForModel } from "../model-catalog"
import {
  applyCodexRuntimeDefaultsToParams,
  findCatalogModelForCandidates,
  getModelLookupCandidates,
  getModelThinkingSummariesOverride,
  getModelVerbosityEnabledOverride,
  getModelVerbosityOverride,
  getVariantLookupCandidates,
  resolvePersonalityForModel
} from "./request-transform"
import { resolveRequestUserAgent } from "./client-identity"
import { resolveCodexOriginator } from "./originator"
import {
  asString,
  getMessageProviderID,
  isRecord,
  readSessionMessageInfo,
  sessionUsesOpenAIProvider
} from "./session-messages"
import {
  CODEX_CODE_MODE_INSTRUCTIONS,
  CODEX_ORCHESTRATOR_INSTRUCTIONS,
  ensureOpenCodeToolingCompatibility,
  getCodexPlanModeInstructions,
  isOrchestratorInstructions,
  mergeInstructions,
  resolveCollaborationInstructions,
  resolveCollaborationProfile,
  resolveSubagentHeaderValue,
  resolveToolingInstructions,
  type CollaborationToolProfile
} from "./collaboration"

function normalizeVerbositySetting(value: unknown): "default" | "low" | "medium" | "high" | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "default" || normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized
  }
  return undefined
}

export async function handleChatMessageHook(input: {
  hookInput: { model?: { providerID?: string }; sessionID: string }
  output: { parts: unknown[] }
  client: PluginInput["client"] | undefined
}): Promise<void> {
  const directProviderID = input.hookInput.model?.providerID
  const isOpenAI =
    directProviderID === "openai" ||
    (directProviderID === undefined && (await sessionUsesOpenAIProvider(input.client, input.hookInput.sessionID)))
  if (!isOpenAI) return

  for (const part of input.output.parts) {
    const partRecord = part as Record<string, unknown>
    if (asString(partRecord.type) !== "subtask") continue
    if ((asString(partRecord.command) ?? "").trim().toLowerCase() !== "review") continue
    partRecord.agent = "Codex Review"
  }
}

export async function handleChatParamsHook(input: {
  hookInput: {
    model: {
      providerID?: string
      options?: unknown
      id: string
      api?: { id?: string }
      capabilities?: { toolcall?: boolean }
    }
    agent?: unknown
    message: unknown
  }
  output: Parameters<typeof applyCodexRuntimeDefaultsToParams>[0]["output"]
  lastCatalogModels: CodexModelInfo[] | undefined
  behaviorSettings?: BehaviorSettings
  fallbackPersonality?: PersonalityOption
  spoofMode: CodexSpoofMode
  collaborationProfileEnabled: boolean
  orchestratorSubagentsEnabled: boolean
  collaborationToolProfile: CollaborationToolProfile
}): Promise<void> {
  if (input.hookInput.model.providerID !== "openai") return
  const modelOptions = isRecord(input.hookInput.model.options) ? input.hookInput.model.options : {}
  const modelCandidates = getModelLookupCandidates({
    id: input.hookInput.model.id,
    api: { id: input.hookInput.model.api?.id }
  })
  const variantCandidates = getVariantLookupCandidates({
    message: input.hookInput.message,
    modelCandidates
  })
  const catalogModelFallback = findCatalogModelForCandidates(input.lastCatalogModels, modelCandidates)
  const effectivePersonality = resolvePersonalityForModel({
    behaviorSettings: input.behaviorSettings,
    modelCandidates,
    variantCandidates,
    fallback: input.fallbackPersonality
  })
  const modelThinkingSummariesOverride = getModelThinkingSummariesOverride(
    input.behaviorSettings,
    modelCandidates,
    variantCandidates
  )
  const modelVerbosityEnabledOverride = getModelVerbosityEnabledOverride(
    input.behaviorSettings,
    modelCandidates,
    variantCandidates
  )
  const modelVerbosityOverride = getModelVerbosityOverride(input.behaviorSettings, modelCandidates, variantCandidates)
  const globalBehavior = input.behaviorSettings?.global
  const globalVerbosityEnabled =
    typeof globalBehavior?.verbosityEnabled === "boolean" ? globalBehavior.verbosityEnabled : undefined
  const globalVerbosity = normalizeVerbositySetting(globalBehavior?.verbosity)
  const catalogModelFromOptions = isRecord(modelOptions.codexCatalogModel)
    ? (modelOptions.codexCatalogModel as CodexModelInfo)
    : undefined
  let renderedCatalogInstructions = catalogModelFromOptions
    ? resolveInstructionsForModel(catalogModelFromOptions, effectivePersonality)
    : undefined

  if (!renderedCatalogInstructions && catalogModelFallback) {
    if (!catalogModelFromOptions) {
      modelOptions.codexCatalogModel = catalogModelFallback
    }
    renderedCatalogInstructions = resolveInstructionsForModel(catalogModelFallback, effectivePersonality)
    const defaults = getRuntimeDefaultsForModel(catalogModelFallback)
    if (defaults) {
      modelOptions.codexRuntimeDefaults = defaults
    }
  }

  if (renderedCatalogInstructions) {
    modelOptions.codexInstructions = renderedCatalogInstructions
  } else {
    const directModelInstructions = asString((input.hookInput.model as Record<string, unknown>).instructions)
    if (directModelInstructions) {
      modelOptions.codexInstructions = directModelInstructions
    } else if (asString(modelOptions.codexInstructions) === undefined) {
      delete modelOptions.codexInstructions
    }
  }
  const profile = resolveCollaborationProfile(input.hookInput.agent)
  const preserveOrchestratorInstructions =
    profile.isOrchestrator === true && isOrchestratorInstructions(asString(input.output.options.instructions))

  applyCodexRuntimeDefaultsToParams({
    modelOptions,
    modelToolCallCapable: input.hookInput.model.capabilities?.toolcall,
    thinkingSummariesOverride: modelThinkingSummariesOverride ?? globalBehavior?.thinkingSummaries,
    verbosityEnabledOverride: modelVerbosityEnabledOverride ?? globalVerbosityEnabled,
    verbosityOverride: modelVerbosityOverride ?? globalVerbosity,
    preferCodexInstructions: input.spoofMode === "codex" && !preserveOrchestratorInstructions,
    output: input.output
  })

  input.output.options.instructions = ensureOpenCodeToolingCompatibility(asString(input.output.options.instructions))

  if (!input.collaborationProfileEnabled) return

  if (!profile.enabled || !profile.kind) return

  const collaborationInstructions = resolveCollaborationInstructions(profile.kind, {
    plan: getCodexPlanModeInstructions(),
    code: CODEX_CODE_MODE_INSTRUCTIONS
  })
  let mergedInstructions = mergeInstructions(asString(input.output.options.instructions), collaborationInstructions)

  if (profile.isOrchestrator && input.orchestratorSubagentsEnabled) {
    mergedInstructions = mergeInstructions(mergedInstructions, CODEX_ORCHESTRATOR_INSTRUCTIONS)
  }

  mergedInstructions = mergeInstructions(mergedInstructions, resolveToolingInstructions(input.collaborationToolProfile))

  input.output.options.instructions = mergedInstructions
}

export async function handleChatHeadersHook(input: {
  hookInput: { model: { providerID?: string }; sessionID: string; agent?: unknown }
  output: { headers: Record<string, unknown> }
  spoofMode: CodexSpoofMode
  internalCollaborationModeHeader: string
  internalCollaborationAgentHeader: string
  collaborationProfileEnabled: boolean
  orchestratorSubagentsEnabled: boolean
}): Promise<void> {
  if (input.hookInput.model.providerID !== "openai") return
  const originator = resolveCodexOriginator(input.spoofMode)
  input.output.headers.originator = originator
  input.output.headers["User-Agent"] = resolveRequestUserAgent(input.spoofMode, originator)
  input.output.headers.session_id = input.hookInput.sessionID
  delete input.output.headers["OpenAI-Beta"]
  delete input.output.headers.conversation_id

  if (!input.collaborationProfileEnabled) {
    delete input.output.headers["x-openai-subagent"]
    delete input.output.headers[input.internalCollaborationModeHeader]
    delete input.output.headers[input.internalCollaborationAgentHeader]
    return
  }

  const profile = resolveCollaborationProfile(input.hookInput.agent)
  if (!profile.enabled || !profile.kind) {
    delete input.output.headers["x-openai-subagent"]
    delete input.output.headers[input.internalCollaborationModeHeader]
    delete input.output.headers[input.internalCollaborationAgentHeader]
    return
  }

  input.output.headers[input.internalCollaborationModeHeader] = profile.kind
  input.output.headers[input.internalCollaborationAgentHeader] = profile.isOrchestrator ? "orchestrator" : profile.kind

  if (input.orchestratorSubagentsEnabled) {
    const subagentHeader = resolveSubagentHeaderValue(input.hookInput.agent)
    if (subagentHeader) {
      input.output.headers["x-openai-subagent"] = subagentHeader
    } else {
      delete input.output.headers["x-openai-subagent"]
    }
    return
  }

  delete input.output.headers["x-openai-subagent"]
}

export async function handleSessionCompactingHook(input: {
  enabled: boolean
  hookInput: { sessionID: string }
  output: { prompt?: string }
  client: PluginInput["client"] | undefined
  summaryPrefixSessions: Set<string>
  compactPrompt: string
}): Promise<void> {
  if (!input.enabled) return
  if (await sessionUsesOpenAIProvider(input.client, input.hookInput.sessionID)) {
    input.output.prompt = input.compactPrompt
    input.summaryPrefixSessions.add(input.hookInput.sessionID)
  }
}

export async function handleTextCompleteHook(input: {
  enabled: boolean
  hookInput: { sessionID: string; messageID: string }
  output: { text: string }
  client: PluginInput["client"] | undefined
  summaryPrefixSessions: Set<string>
  compactSummaryPrefix: string
}): Promise<void> {
  if (!input.enabled) return
  if (!input.summaryPrefixSessions.has(input.hookInput.sessionID)) return

  const info = await readSessionMessageInfo(input.client, input.hookInput.sessionID, input.hookInput.messageID)
  input.summaryPrefixSessions.delete(input.hookInput.sessionID)
  if (!info) return
  if (asString(info.role) !== "assistant") return
  if (asString(info.agent) !== "compaction") return
  if (info.summary !== true) return
  if (getMessageProviderID(info) !== "openai") return
  if (input.output.text.startsWith(input.compactSummaryPrefix)) return

  input.output.text = `${input.compactSummaryPrefix}\n${input.output.text.trimStart()}`
}
