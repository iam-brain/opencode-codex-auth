import type { PluginInput } from "@opencode-ai/plugin"

import type { CodexSpoofMode, CustomSettings, PersonalityOption } from "../config"
import type { CodexModelInfo } from "../model-catalog"
import { getRuntimeDefaultsForModel, resolveInstructionsForModel } from "../model-catalog"
import {
  applyCodexRuntimeDefaultsToParams,
  findCatalogModelForCandidates,
  getModelLookupCandidates,
  getModelThinkingSummariesOverride,
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
    message: unknown
  }
  output: Parameters<typeof applyCodexRuntimeDefaultsToParams>[0]["output"]
  lastCatalogModels: CodexModelInfo[] | undefined
  customSettings?: CustomSettings
  fallbackPersonality?: PersonalityOption
  spoofMode: CodexSpoofMode
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
    customSettings: input.customSettings,
    modelCandidates,
    variantCandidates,
    fallback: input.fallbackPersonality
  })
  const modelThinkingSummariesOverride = getModelThinkingSummariesOverride(
    input.customSettings,
    modelCandidates,
    variantCandidates
  )
  if (isRecord(modelOptions.codexCatalogModel)) {
    const rendered = resolveInstructionsForModel(modelOptions.codexCatalogModel as CodexModelInfo, effectivePersonality)
    if (rendered) {
      modelOptions.codexInstructions = rendered
    } else {
      delete modelOptions.codexInstructions
    }
  } else if (catalogModelFallback) {
    modelOptions.codexCatalogModel = catalogModelFallback
    const rendered = resolveInstructionsForModel(catalogModelFallback, effectivePersonality)
    if (rendered) {
      modelOptions.codexInstructions = rendered
    } else {
      delete modelOptions.codexInstructions
    }
    const defaults = getRuntimeDefaultsForModel(catalogModelFallback)
    if (defaults) {
      modelOptions.codexRuntimeDefaults = defaults
    }
  } else if (asString(modelOptions.codexInstructions) === undefined) {
    const directModelInstructions = asString((input.hookInput.model as Record<string, unknown>).instructions)
    if (directModelInstructions) {
      modelOptions.codexInstructions = directModelInstructions
    }
  }
  applyCodexRuntimeDefaultsToParams({
    modelOptions,
    modelToolCallCapable: input.hookInput.model.capabilities?.toolcall,
    thinkingSummariesOverride: modelThinkingSummariesOverride ?? input.customSettings?.thinkingSummaries,
    preferCodexInstructions: input.spoofMode === "codex",
    output: input.output
  })
}

export async function handleChatHeadersHook(input: {
  hookInput: { model: { providerID?: string }; sessionID: string }
  output: { headers: Record<string, unknown> }
  spoofMode: CodexSpoofMode
  internalCollaborationModeHeader: string
}): Promise<void> {
  if (input.hookInput.model.providerID !== "openai") return
  const originator = resolveCodexOriginator(input.spoofMode)
  input.output.headers.originator = originator
  input.output.headers["User-Agent"] = resolveRequestUserAgent(input.spoofMode, originator)
  input.output.headers.session_id = input.hookInput.sessionID
  delete input.output.headers["OpenAI-Beta"]
  delete input.output.headers.conversation_id
  if (input.spoofMode !== "native") {
    delete input.output.headers["x-openai-subagent"]
    delete input.output.headers[input.internalCollaborationModeHeader]
  }
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
