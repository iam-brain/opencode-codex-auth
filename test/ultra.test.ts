import { describe, expect, it } from "vitest"

import type { CodexModelInfo } from "../lib/model-catalog.js"
import { handleChatParamsHook } from "../lib/codex-native/chat-hooks.js"
import { transformOutboundRequestPayload } from "../lib/codex-native/request-transform-payload.js"
import {
  ULTRA_EXPLICIT_ONLY_INSTRUCTIONS,
  ULTRA_PROACTIVE_INSTRUCTIONS,
  isUltraEligible,
  parseUltraState,
  retainUltraState,
  resolveUltraSelection
} from "../lib/codex-native/ultra.js"

function eligibleModel(overrides: Partial<CodexModelInfo> = {}): CodexModelInfo {
  return {
    slug: "gpt-5.6-sol",
    context_window: 372000,
    multi_agent_version: "v2",
    supported_in_api: true,
    visibility: "list",
    default_reasoning_level: "ultra",
    supported_reasoning_levels: [{ effort: "max" }, { effort: "ultra" }],
    ...overrides
  }
}

function chatOutput(): { temperature: number; topP: number; topK: number; options: Record<string, unknown> } {
  return { temperature: 0, topP: 1, topK: 0, options: {} }
}

describe("GPT-5.6 Ultra contract", () => {
  it("resolves session lineage only for Ultra requests", async () => {
    let calls = 0
    const output = chatOutput()
    output.options.reasoningEffort = "high"
    await handleChatParamsHook({
      hookInput: {
        model: { id: "gpt-5.6-sol", providerID: "openai", options: {} },
        agent: "build",
        message: {}
      },
      output,
      lastCatalogModels: [eligibleModel()],
      spoofMode: "codex",
      collaborationProfileEnabled: false,
      orchestratorSubagentsEnabled: false,
      resolveAgentExecution: async () => {
        calls += 1
        return { role: "root", reason: "session_root" }
      }
    })

    expect(calls).toBe(0)
  })

  it("requires Ultra, V2, visible status, and explicit API support", () => {
    expect(isUltraEligible(eligibleModel())).toBe(true)
    expect(isUltraEligible(eligibleModel({ multi_agent_version: "v1" }))).toBe(false)
    expect(isUltraEligible(eligibleModel({ supported_in_api: false }))).toBe(false)
    expect(isUltraEligible(eligibleModel({ visibility: "hidden" }))).toBe(false)
    expect(isUltraEligible(eligibleModel({ supported_in_api: undefined }))).toBe(false)
    expect(isUltraEligible(eligibleModel({ visibility: undefined }))).toBe(false)
    expect(isUltraEligible(eligibleModel({ catalog_source: "github_fallback" }))).toBe(false)
  })

  it("parses only valid internal logical-state metadata", () => {
    const state = resolveUltraSelection({ reasoningEffort: "ultra", model: eligibleModel() })
    expect(parseUltraState(JSON.stringify(state))).toEqual(state)
    expect(parseUltraState("not-json")).toBeUndefined()
    expect(parseUltraState(JSON.stringify({ selected: false, logicalEffort: "max" }))).toBeUndefined()
    expect(parseUltraState(JSON.stringify({ ...state, secret: "must-not-survive" }))).toEqual(state)
    expect(parseUltraState(JSON.stringify({ ...state, wireEffort: "ultra" }))).toBeUndefined()
    expect(retainUltraState(state, undefined)).toEqual(state)
  })

  it("keeps logical Ultra and adds proactive instructions for codex root turns", async () => {
    const output = chatOutput()
    const result = await handleChatParamsHook({
      hookInput: {
        model: {
          id: "gpt-5.6-sol",
          providerID: "openai",
          options: {
            codexCatalogModel: eligibleModel(),
            codexRuntimeDefaults: { defaultReasoningEffort: "ultra" }
          }
        },
        agent: "build",
        message: {}
      },
      output,
      lastCatalogModels: [eligibleModel()],
      spoofMode: "codex",
      collaborationProfileEnabled: false,
      orchestratorSubagentsEnabled: false,
      agentExecution: { role: "root", reason: "session_root", agentName: "build" }
    })

    expect(output.options.reasoningEffort).toBe("ultra")
    expect(output.options.instructions).toContain(ULTRA_PROACTIVE_INSTRUCTIONS)
    expect(result.ultra).toMatchObject({
      logicalEffort: "ultra",
      wireEffort: "max",
      delegationPolicy: "proactive",
      eligible: true
    })
  })

  it("preserves native identity and uses explicit-only instructions for child codex turns", async () => {
    const nativeOutput = chatOutput()
    await handleChatParamsHook({
      hookInput: {
        model: {
          id: "gpt-5.6-sol",
          providerID: "openai",
          options: {
            codexCatalogModel: eligibleModel(),
            codexRuntimeDefaults: { defaultReasoningEffort: "ultra" }
          }
        },
        agent: "build",
        message: {}
      },
      output: nativeOutput,
      lastCatalogModels: [eligibleModel()],
      spoofMode: "native",
      collaborationProfileEnabled: true,
      orchestratorSubagentsEnabled: true
    })
    expect(nativeOutput.options.instructions).toBeUndefined()

    const childOutput = chatOutput()
    const childResult = await handleChatParamsHook({
      hookInput: {
        model: {
          id: "gpt-5.6-sol",
          providerID: "openai",
          options: {
            codexCatalogModel: eligibleModel(),
            codexRuntimeDefaults: { defaultReasoningEffort: "ultra" }
          }
        },
        agent: "codex-review",
        message: {}
      },
      output: childOutput,
      lastCatalogModels: [eligibleModel()],
      spoofMode: "codex",
      collaborationProfileEnabled: true,
      orchestratorSubagentsEnabled: true,
      agentExecution: { role: "child", reason: "session_parent", agentName: "general" }
    })
    expect(childOutput.options.instructions).toContain(ULTRA_EXPLICIT_ONLY_INSTRUCTIONS)
    expect(childOutput.options.instructions).not.toContain(ULTRA_PROACTIVE_INSTRUCTIONS)
    expect(childResult.ultra?.delegationPolicy).toBe("explicit_request_only")
    expect(childResult.ultra?.agentRole).toBe("child")
  })

  it("does not inject delegation policy into OpenCode auxiliary turns", async () => {
    for (const agentName of ["title", "summary", "compaction"]) {
      const output = chatOutput()
      const result = await handleChatParamsHook({
        hookInput: {
          model: {
            id: "gpt-5.6-sol",
            providerID: "openai",
            options: {
              codexCatalogModel: eligibleModel(),
              codexRuntimeDefaults: { defaultReasoningEffort: "ultra" }
            }
          },
          agent: agentName,
          message: {}
        },
        output,
        lastCatalogModels: [eligibleModel()],
        spoofMode: "codex",
        collaborationProfileEnabled: true,
        orchestratorSubagentsEnabled: true,
        agentExecution: { role: "auxiliary", reason: "builtin_auxiliary", agentName }
      })

      expect(output.options.instructions).toBeUndefined()
      expect(result.ultra).toMatchObject({ agentRole: "auxiliary", delegationPolicy: "disabled" })
    }
  })

  it("normalizes logical Ultra to wire Max at the final request boundary", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.6-sol", reasoning: { effort: "ultra" } })
    })

    const transformed = await transformOutboundRequestPayload({
      request,
      selectedModelSlug: "gpt-5.6-sol",
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false,
      catalogModels: [eligibleModel()]
    })

    expect(JSON.parse(await transformed.request.text()).reasoning.effort).toBe("max")
    expect(transformed.ultra).toMatchObject({ logicalEffort: "ultra", wireEffort: "max" })
  })

  it("keeps explicit Max separate from Ultra and resolves custom targets", async () => {
    const maxRequest = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.6-sol", reasoning: { effort: "max" } })
    })
    const max = await transformOutboundRequestPayload({
      request: maxRequest,
      selectedModelSlug: "gpt-5.6-sol",
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false,
      catalogModels: [eligibleModel()]
    })
    expect(max.ultra).toBeUndefined()

    const customRequest = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      body: JSON.stringify({ model: "my-sol", reasoning: { effort: "ultra" } })
    })
    const custom = await transformOutboundRequestPayload({
      request: customRequest,
      selectedModelSlug: "my-sol",
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false,
      catalogModels: [eligibleModel()],
      customModels: { "my-sol": { targetModel: "gpt-5.6-sol" } }
    })
    expect(JSON.parse(await custom.request.text()).reasoning.effort).toBe("max")
    expect(custom.ultra?.eligible).toBe(true)
  })

  it("preserves logical Ultra metadata when a retry body already contains wire Max", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.6-sol", reasoning: { effort: "max" } })
    })
    const transformed = await transformOutboundRequestPayload({
      request,
      selectedModelSlug: "gpt-5.6-sol",
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false,
      catalogModels: [eligibleModel()],
      ultraState: resolveUltraSelection({ reasoningEffort: "ultra", model: eligibleModel() })
    })

    expect(transformed.ultra).toMatchObject({ logicalEffort: "ultra", wireEffort: "max" })
    expect(JSON.parse(await transformed.request.text()).reasoning.effort).toBe("max")
  })

  it("retains explicit-only child policy when collaboration headers are unavailable", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.6-sol", reasoning: { effort: "max" } })
    })
    const transformed = await transformOutboundRequestPayload({
      request,
      selectedModelSlug: "gpt-5.6-sol",
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false,
      catalogModels: [eligibleModel()],
      ultraState: resolveUltraSelection({ reasoningEffort: "ultra", model: eligibleModel(), childTask: true })
    })

    expect(transformed.ultra?.delegationPolicy).toBe("explicit_request_only")
  })

  it("retains disabled auxiliary policy across retries", async () => {
    const state = resolveUltraSelection({
      reasoningEffort: "ultra",
      model: eligibleModel(),
      agentExecution: { role: "auxiliary", reason: "builtin_auxiliary", agentName: "summary" }
    })
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.6-sol", reasoning: { effort: "max" } })
    })
    const transformed = await transformOutboundRequestPayload({
      request,
      selectedModelSlug: "gpt-5.6-sol",
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false,
      catalogModels: [eligibleModel()],
      ultraState: state
    })

    expect(transformed.ultra).toMatchObject({ agentRole: "auxiliary", delegationPolicy: "disabled" })
  })

  it("degrades an Ultra selection without authoritative V2 metadata to wire Max only", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      body: JSON.stringify({ model: "gpt-5.6-sol", reasoning: { effort: "ultra" } })
    })
    const transformed = await transformOutboundRequestPayload({
      request,
      selectedModelSlug: "gpt-5.6-sol",
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false,
      catalogModels: [eligibleModel({ multi_agent_version: undefined })]
    })
    expect(JSON.parse(await transformed.request.text()).reasoning.effort).toBe("max")
    expect(
      resolveUltraSelection({ reasoningEffort: "ultra", model: eligibleModel({ multi_agent_version: undefined }) })
    ).toMatchObject({
      eligible: false,
      delegationPolicy: "explicit_request_only",
      reason: "missing_multi_agent_v2"
    })
  })
})
