import type { PluginInput } from "@opencode-ai/plugin"

import type { BehaviorSettings, CodexSpoofMode, PersonalityOption, UltraReasoningEffort } from "../config.js"
import type { CodexModelInfo } from "../model-catalog.js"
import type { AgentExecution } from "./agent-execution.js"
import { getRuntimeDefaultsForModel, resolveInstructionsForModel } from "../model-catalog.js"
import {
  applyCodexRuntimeDefaultsToParams,
  findCatalogModelForCandidates,
  getCustomModelIncludeOverride,
  getCustomModelParallelToolCallsOverride,
  getCustomModelReasoningEffortOverride,
  getCustomModelReasoningModeOverride,
  getCustomModelReasoningSummaryOverride,
  getCustomModelTextVerbosityOverride,
  getModelLookupCandidates,
  getModelIncludeOverride,
  getModelParallelToolCallsOverride,
  getModelReasoningEffortOverride,
  getModelReasoningModeOverride,
  getModelReasoningSummaryOverride,
  getSelectedModelLookupCandidates,
  getModelTextVerbosityOverride,
  getVariantLookupCandidates,
  resolvePersonalityForModel,
  supportsReasoningMode
} from "./request-transform-model.js"
import { resolveServiceTierForModel } from "./request-transform-model-service-tier.js"
import { resolveRequestUserAgent } from "./client-identity.js"
import { resolveCodexOriginator } from "./originator.js"
import {
  asString,
  getMessageProviderID,
  isRecord,
  readSessionMessageInfo,
  sessionUsesOpenAIProvider
} from "./session-messages.js"
import { mergeInstructions, replaceCodexToolCallsForOpenCode, resolveHookAgentName } from "./instruction-utils.js"
import {
  ULTRA_EXPLICIT_ONLY_INSTRUCTIONS,
  ULTRA_PROACTIVE_INSTRUCTIONS,
  resolveUltraSelection,
  stripUltraDelegationInstructions,
  type UltraResolution
} from "./ultra.js"

function normalizeVerbositySetting(value: unknown): "default" | "low" | "medium" | "high" | "none" | undefined {
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

function disableUltraRuntimeDefaults(modelOptions: Record<string, unknown>): void {
  const defaults = isRecord(modelOptions.codexRuntimeDefaults) ? modelOptions.codexRuntimeDefaults : undefined
  if (!defaults) return
  const next = { ...defaults }
  if (asString(next.defaultReasoningEffort)?.toLowerCase() === "ultra") {
    next.defaultReasoningEffort = "max"
  }
  if (Array.isArray(next.supportedReasoningEfforts)) {
    next.supportedReasoningEfforts = next.supportedReasoningEfforts.filter(
      (effort) => typeof effort !== "string" || effort.trim().toLowerCase() !== "ultra"
    )
  }
  modelOptions.codexRuntimeDefaults = next
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
}

export async function handleChatParamsHook(input: {
  hookInput: {
    sessionID?: string
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
  projectRoot?: string
  spoofMode: CodexSpoofMode
  ultraEnabled?: boolean
  ultraReasoningEffort?: UltraReasoningEffort
  agentExecution?: AgentExecution
  resolveAgentExecution?: () => Promise<AgentExecution>
}): Promise<{ injectedCatalogDefaultFields: string[]; ultra?: UltraResolution }> {
  const emptyResult = { injectedCatalogDefaultFields: [] }
  if (input.hookInput.model.providerID !== "openai") return emptyResult
  const modelOptions = isRecord(input.hookInput.model.options) ? input.hookInput.model.options : {}
  const selectedModelCandidates = getSelectedModelLookupCandidates({
    id: input.hookInput.model.id
  })
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
    modelOptions,
    modelCandidates: selectedModelCandidates,
    variantCandidates,
    fallback: input.fallbackPersonality
  })
  const customModelReasoningEffortOverride = getCustomModelReasoningEffortOverride(modelOptions, variantCandidates)
  const customModelReasoningModeOverride = getCustomModelReasoningModeOverride(modelOptions, variantCandidates)
  const customModelReasoningSummaryOverride = getCustomModelReasoningSummaryOverride(modelOptions, variantCandidates)
  const customModelTextVerbosityOverride = getCustomModelTextVerbosityOverride(modelOptions, variantCandidates)
  const customModelIncludeOverride = getCustomModelIncludeOverride(modelOptions, variantCandidates)
  const customModelParallelToolCallsOverride = getCustomModelParallelToolCallsOverride(modelOptions, variantCandidates)
  const modelReasoningEffortOverride = getModelReasoningEffortOverride(
    input.behaviorSettings,
    selectedModelCandidates,
    variantCandidates
  )
  const modelReasoningModeOverride = getModelReasoningModeOverride(
    input.behaviorSettings,
    selectedModelCandidates,
    variantCandidates
  )
  const modelReasoningSummaryOverride = getModelReasoningSummaryOverride(
    input.behaviorSettings,
    selectedModelCandidates,
    variantCandidates
  )
  const modelTextVerbosityOverride = getModelTextVerbosityOverride(
    input.behaviorSettings,
    selectedModelCandidates,
    variantCandidates
  )
  const modelIncludeOverride = getModelIncludeOverride(
    input.behaviorSettings,
    selectedModelCandidates,
    variantCandidates
  )
  const modelParallelToolCallsOverride = getModelParallelToolCallsOverride(
    input.behaviorSettings,
    selectedModelCandidates,
    variantCandidates
  )
  const globalBehavior = input.behaviorSettings?.global
  const globalReasoningSummary =
    typeof globalBehavior?.reasoningSummary === "string"
      ? globalBehavior.reasoningSummary
      : typeof globalBehavior?.reasoningSummaries === "boolean"
        ? globalBehavior.reasoningSummaries
          ? "auto"
          : "none"
        : undefined
  const globalTextVerbosity =
    normalizeVerbositySetting(globalBehavior?.textVerbosity) ??
    (typeof globalBehavior?.verbosityEnabled === "boolean" && globalBehavior.verbosityEnabled === false
      ? "none"
      : normalizeVerbositySetting(globalBehavior?.verbosity))
  const catalogModelFromOptions = isRecord(modelOptions.codexCatalogModel)
    ? (modelOptions.codexCatalogModel as CodexModelInfo)
    : undefined
  let renderedCatalogInstructions = catalogModelFromOptions
    ? resolveInstructionsForModel(catalogModelFromOptions, effectivePersonality, {
        projectRoot: input.projectRoot
      })
    : undefined

  if (!renderedCatalogInstructions && catalogModelFallback) {
    if (!catalogModelFromOptions) {
      modelOptions.codexCatalogModel = catalogModelFallback
    }
    renderedCatalogInstructions = resolveInstructionsForModel(catalogModelFallback, effectivePersonality, {
      projectRoot: input.projectRoot
    })
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

  if (!input.ultraEnabled) {
    disableUltraRuntimeDefaults(modelOptions)
  }

  if (asString(input.output.options.serviceTier) === undefined) {
    const resolvedServiceTier = resolveServiceTierForModel({
      behaviorSettings: input.behaviorSettings,
      modelOptions,
      modelCandidates: selectedModelCandidates,
      variantCandidates
    })
    if (resolvedServiceTier && resolvedServiceTier !== "auto") {
      input.output.options.serviceTier = resolvedServiceTier
    }
  }
  const runtimeDefaultsResult = applyCodexRuntimeDefaultsToParams({
    modelOptions,
    modelToolCallCapable: input.hookInput.model.capabilities?.toolcall,
    resolvedBehavior: {
      reasoningEffort:
        modelReasoningEffortOverride ?? customModelReasoningEffortOverride ?? globalBehavior?.reasoningEffort,
      reasoningMode: supportsReasoningMode(modelCandidates)
        ? (modelReasoningModeOverride ?? customModelReasoningModeOverride ?? globalBehavior?.reasoningMode)
        : undefined,
      reasoningSummary: modelReasoningSummaryOverride ?? customModelReasoningSummaryOverride ?? globalReasoningSummary,
      textVerbosity: modelTextVerbosityOverride ?? customModelTextVerbosityOverride ?? globalTextVerbosity,
      include: modelIncludeOverride ?? customModelIncludeOverride ?? globalBehavior?.include,
      parallelToolCalls:
        modelParallelToolCallsOverride ?? customModelParallelToolCallsOverride ?? globalBehavior?.parallelToolCalls
    },
    preferCodexInstructions: input.spoofMode === "codex",
    modelId: input.hookInput.model.id,
    output: input.output
  })

  if (!input.ultraEnabled && asString(input.output.options.reasoningEffort)?.toLowerCase() === "ultra") {
    input.output.options.reasoningEffort = "max"
  }

  const ultraSelected =
    input.ultraEnabled && asString(input.output.options.reasoningEffort)?.trim().toLowerCase() === "ultra"
  const agentExecution =
    input.agentExecution ??
    (ultraSelected && input.resolveAgentExecution ? await input.resolveAgentExecution() : undefined)
  const ultraResolution = input.ultraEnabled
    ? resolveUltraSelection({
        reasoningEffort: input.output.options.reasoningEffort,
        wireReasoningEffort: input.ultraReasoningEffort,
        model: catalogModelFromOptions ?? catalogModelFallback,
        agentExecution
      })
    : undefined
  if (
    input.spoofMode === "codex" &&
    ultraResolution?.selected &&
    ultraResolution.eligible &&
    ultraResolution.delegationPolicy !== "disabled"
  ) {
    const ultraInstructions =
      ultraResolution.delegationPolicy === "proactive" ? ULTRA_PROACTIVE_INSTRUCTIONS : ULTRA_EXPLICIT_ONLY_INSTRUCTIONS
    stripUltraDelegationInstructions(input.output.options as Record<string, unknown>)
    input.output.options.instructions = mergeInstructions(
      asString(input.output.options.instructions),
      ultraInstructions
    )
  }
  const result = (): { injectedCatalogDefaultFields: string[]; ultra?: UltraResolution } => ({
    injectedCatalogDefaultFields: runtimeDefaultsResult.injectedFields,
    ...(ultraResolution?.selected ? { ultra: ultraResolution } : {})
  })

  if (input.spoofMode !== "codex") {
    return result()
  }

  const normalizedAgentName = resolveHookAgentName(input.hookInput.agent)?.trim().toLowerCase()
  if (normalizedAgentName === "build") {
    const current = asString(input.output.options.instructions)
    const replaced = replaceCodexToolCallsForOpenCode(current)
    if (replaced) {
      input.output.options.instructions = replaced
    }
    return result()
  }

  return result()
}

export async function handleChatHeadersHook(input: {
  hookInput: { model: { providerID?: string; id?: string }; sessionID: string; agent?: unknown }
  output: { headers: Record<string, unknown> }
  spoofMode: CodexSpoofMode
  requestCatalogScopeKey?: string
  injectedCatalogDefaultFields?: string[]
  ultra?: UltraResolution
  internalUltraStateHeader?: string
  internalCatalogScopeHeader: string
  internalCatalogDefaultsHeader: string
  internalSelectedModelHeader: string
}): Promise<void> {
  if (input.hookInput.model.providerID !== "openai") return
  const originator = resolveCodexOriginator(input.spoofMode)
  input.output.headers.originator = originator
  input.output.headers["User-Agent"] = resolveRequestUserAgent(input.spoofMode, originator)
  input.output.headers["session-id"] = input.hookInput.sessionID
  delete input.output.headers.session_id
  if (typeof input.hookInput.model.id === "string" && input.hookInput.model.id.trim()) {
    input.output.headers[input.internalSelectedModelHeader] = input.hookInput.model.id
  } else {
    delete input.output.headers[input.internalSelectedModelHeader]
  }
  delete input.output.headers["OpenAI-Beta"]
  delete input.output.headers.conversation_id
  if (input.requestCatalogScopeKey) {
    input.output.headers[input.internalCatalogScopeHeader] = input.requestCatalogScopeKey
  } else {
    delete input.output.headers[input.internalCatalogScopeHeader]
  }
  if (input.injectedCatalogDefaultFields && input.injectedCatalogDefaultFields.length > 0) {
    input.output.headers[input.internalCatalogDefaultsHeader] = input.injectedCatalogDefaultFields.join(",")
  } else {
    delete input.output.headers[input.internalCatalogDefaultsHeader]
  }
  const internalUltraStateHeader = input.internalUltraStateHeader ?? "x-opencode-ultra-state"
  if (input.ultra?.selected) {
    input.output.headers[internalUltraStateHeader] = JSON.stringify(input.ultra)
  } else {
    delete input.output.headers[internalUltraStateHeader]
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
