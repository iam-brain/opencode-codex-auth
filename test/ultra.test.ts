import { describe, expect, it } from "vitest"

import type { CodexModelInfo } from "../lib/model-catalog.js"
import { CodexAuthPlugin } from "../lib/codex-native.js"
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
  it("uses the generated OpenCode-compatible multi-agent mode messages", () => {
    expect(ULTRA_PROACTIVE_INSTRUCTIONS).toBe(`<multi_agent_mode>
Proactive multi-agent delegation is active. Any earlier instruction requiring an explicit user request before using the OpenCode \`task\` tool no longer applies. Use the OpenCode \`task\` tool when parallel work would materially improve speed or quality. This mode remains active until a later multi-agent mode developer message changes it.
</multi_agent_mode>`)
    expect(ULTRA_EXPLICIT_ONLY_INSTRUCTIONS).toBe(`<multi_agent_mode>
Any earlier instruction enabling proactive multi-agent delegation no longer applies. Do not use the OpenCode \`task\` tool unless the user or applicable AGENTS.md/skill instructions explicitly ask for sub-agents, delegation, or parallel agent work.
</multi_agent_mode>`)
  })

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
      ultraEnabled: true,
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
    expect(isUltraEligible(eligibleModel({ catalog_source: "github_fallback" }))).toBe(true)
  })

  it("parses only valid internal logical-state metadata", () => {
    const state = resolveUltraSelection({ reasoningEffort: "ultra", model: eligibleModel() })
    expect(parseUltraState(JSON.stringify(state))).toEqual(state)
    expect(parseUltraState("not-json")).toBeUndefined()
    expect(parseUltraState(JSON.stringify({ selected: false, logicalEffort: "max" }))).toBeUndefined()
    expect(parseUltraState(JSON.stringify({ ...state, secret: "must-not-survive" }))).toEqual(state)
    expect(parseUltraState(JSON.stringify({ ...state, wireEffort: "ultra" }))).toBeUndefined()
    expect(parseUltraState(JSON.stringify({ ...state, delegationPolicy: "explicit_request_only" }))).toBeUndefined()
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
      ultraEnabled: true,
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

  it("replaces an earlier explicit-only mode with proactive mode", async () => {
    const output = chatOutput()
    output.options.instructions = `base\n\n${ULTRA_EXPLICIT_ONLY_INSTRUCTIONS}`

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
      output,
      lastCatalogModels: [eligibleModel()],
      spoofMode: "codex",
      ultraEnabled: true,
      agentExecution: { role: "root", reason: "session_root", agentName: "build" }
    })

    expect(output.options.instructions).toBe(`base\n\n${ULTRA_PROACTIVE_INSTRUCTIONS}`)
  })

  it("preserves native identity and keeps inherited Ultra proactive for child codex turns", async () => {
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
      ultraEnabled: true
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
      ultraEnabled: true,
      agentExecution: { role: "child", reason: "session_parent", agentName: "general" }
    })
    expect(childOutput.options.instructions).toContain(ULTRA_PROACTIVE_INSTRUCTIONS)
    expect(childOutput.options.instructions).not.toContain(ULTRA_EXPLICIT_ONLY_INSTRUCTIONS)
    expect(childResult.ultra?.delegationPolicy).toBe("proactive")
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
        ultraEnabled: true,
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
      ultraEnabled: true,
      catalogModels: [eligibleModel()]
    })

    expect(JSON.parse(await transformed.request.text()).reasoning.effort).toBe("max")
    expect(transformed.ultra).toMatchObject({ logicalEffort: "ultra", wireEffort: "max" })
  })

  it.each([
    "low",
    "medium",
    "high",
    "xhigh"
  ] as const)("sends the configured %s reasoning effort while retaining logical Ultra", async (ultraReasoningEffort) => {
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
      ultraEnabled: true,
      ultraReasoningEffort,
      catalogModels: [eligibleModel()]
    })

    expect(JSON.parse(await transformed.request.text()).reasoning.effort).toBe(ultraReasoningEffort)
    expect(transformed.ultra).toMatchObject({ logicalEffort: "ultra", wireEffort: ultraReasoningEffort })
  })

  it("reapplies the configured Ultra effort when a retry body already contains max", async () => {
    const transformed = await transformOutboundRequestPayload({
      request: new Request("https://chatgpt.com/backend-api/codex/responses", {
        method: "POST",
        body: JSON.stringify({ model: "gpt-5.6-sol", reasoning: { effort: "max" } })
      }),
      selectedModelSlug: "gpt-5.6-sol",
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false,
      ultraEnabled: true,
      ultraReasoningEffort: "medium",
      catalogModels: [eligibleModel()],
      ultraState: resolveUltraSelection({ reasoningEffort: "ultra", model: eligibleModel() })
    })

    expect(JSON.parse(await transformed.request.text()).reasoning.effort).toBe("medium")
    expect(transformed.ultra?.wireEffort).toBe("medium")
  })

  it("keeps the Ultra WIP hidden and policy-free when the flag is disabled", async () => {
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
      ultraEnabled: false,
      agentExecution: { role: "root", reason: "session_root", agentName: "build" }
    })

    expect(output.options.instructions).toBeUndefined()
    expect(output.options.reasoningEffort).toBe("max")
    expect(result.ultra).toBeUndefined()

    const transformed = await transformOutboundRequestPayload({
      request: new Request("https://chatgpt.com/backend-api/codex/responses", {
        method: "POST",
        body: JSON.stringify({
          model: "gpt-5.6-sol",
          reasoning: { effort: "max" },
          instructions: `base\n\n${ULTRA_PROACTIVE_INSTRUCTIONS}`
        })
      }),
      selectedModelSlug: "gpt-5.6-sol",
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false,
      ultraEnabled: false,
      catalogModels: [eligibleModel()]
    })
    expect(JSON.parse(await transformed.request.text()).instructions).toBe("base")
    expect(transformed.ultra).toBeUndefined()
  })

  it("does not rewrite ordinary instructions while Ultra is disabled", async () => {
    const instructions = "  preserve leading space\n\n\nkeep the intentional gap  "
    const transformed = await transformOutboundRequestPayload({
      request: new Request("https://chatgpt.com/backend-api/codex/responses", {
        method: "POST",
        body: JSON.stringify({
          model: "gpt-5.6-sol",
          reasoning: { effort: "max" },
          instructions
        })
      }),
      selectedModelSlug: "gpt-5.6-sol",
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false,
      ultraEnabled: false,
      catalogModels: [eligibleModel()]
    })

    expect(JSON.parse(await transformed.request.text()).instructions).toBe(instructions)
  })

  it("removes pre-existing provider Ultra variants while the WIP flag is disabled", async () => {
    const hooks = await CodexAuthPlugin({} as never)
    const provider = {
      models: {
        "gpt-5.6-sol": {
          variants: {
            max: { reasoningEffort: "max" },
            ultra: { reasoningEffort: "ultra" }
          }
        }
      }
    }

    await hooks.auth?.loader?.(async () => ({ type: "api", key: "test" }) as never, provider as never)

    expect(provider.models["gpt-5.6-sol"].variants).toEqual({ max: { reasoningEffort: "max" } })
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
      ultraEnabled: true,
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
      ultraEnabled: true,
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
      ultraEnabled: true,
      catalogModels: [eligibleModel()],
      ultraState: resolveUltraSelection({ reasoningEffort: "ultra", model: eligibleModel() })
    })

    expect(transformed.ultra).toMatchObject({ logicalEffort: "ultra", wireEffort: "max" })
    expect(JSON.parse(await transformed.request.text()).reasoning.effort).toBe("max")
  })

  it("removes delegation overlays when account rotation cannot prove Ultra eligibility", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-5.6-sol",
        reasoning: { effort: "max" },
        instructions: `catalog instructions\n\n${ULTRA_PROACTIVE_INSTRUCTIONS}\n\nplan instructions`
      })
    })
    const transformed = await transformOutboundRequestPayload({
      request,
      selectedModelSlug: "gpt-5.6-sol",
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false,
      ultraEnabled: true,
      catalogModels: [eligibleModel({ multi_agent_version: "v1" })],
      ultraState: resolveUltraSelection({
        reasoningEffort: "ultra",
        model: eligibleModel(),
        agentExecution: { role: "root", reason: "session_root" }
      })
    })

    const payload = JSON.parse(await transformed.request.text())
    expect(payload.instructions).toBe("catalog instructions\n\nplan instructions")
    expect(transformed.ultra).toMatchObject({ eligible: false, delegationPolicy: "explicit_request_only" })
  })

  it("correlates Ultra state by message when same-session hooks interleave", async () => {
    const hooks = await CodexAuthPlugin({} as never, { mode: "codex", ultraEnabled: true })
    const model = {
      id: "gpt-5.6-sol",
      providerID: "openai",
      capabilities: { toolcall: true },
      options: {
        codexCatalogModel: eligibleModel(),
        codexRuntimeDefaults: { defaultReasoningEffort: "ultra" }
      }
    }
    const ultraOutput = chatOutput()
    const maxOutput = chatOutput()
    maxOutput.options.reasoningEffort = "max"

    await hooks["chat.params"]?.(
      {
        sessionID: "shared-session",
        agent: "build",
        provider: {},
        message: { id: "ultra-message" },
        model
      } as never,
      ultraOutput as never
    )
    await hooks["chat.params"]?.(
      {
        sessionID: "shared-session",
        agent: "build",
        provider: {},
        message: { id: "max-message" },
        model
      } as never,
      maxOutput as never
    )

    const maxHeaders = { headers: {} as Record<string, unknown> }
    await hooks["chat.headers"]?.(
      {
        sessionID: "shared-session",
        agent: "build",
        provider: {},
        message: { id: "max-message" },
        model
      } as never,
      maxHeaders as never
    )
    const ultraHeaders = { headers: {} as Record<string, unknown> }
    await hooks["chat.headers"]?.(
      {
        sessionID: "shared-session",
        agent: "build",
        provider: {},
        message: { id: "ultra-message" },
        model
      } as never,
      ultraHeaders as never
    )

    expect(maxHeaders.headers["x-opencode-ultra-state"]).toBeUndefined()
    expect(JSON.parse(String(ultraHeaders.headers["x-opencode-ultra-state"]))).toMatchObject({
      logicalEffort: "ultra",
      delegationPolicy: "proactive"
    })
  })

  it.each([
    { name: "duplicate", message: { id: "duplicate-message" } },
    { name: "missing", message: {} }
  ])("fails closed when $name message IDs make hook correlation ambiguous", async ({ message }) => {
    const hooks = await CodexAuthPlugin({} as never, { mode: "codex", ultraEnabled: true })
    const model = {
      id: "gpt-5.6-sol",
      providerID: "openai",
      capabilities: { toolcall: true },
      options: {
        codexCatalogModel: eligibleModel(),
        codexRuntimeDefaults: { defaultReasoningEffort: "ultra" }
      }
    }
    const ultraOutput = chatOutput()
    const maxOutput = chatOutput()
    maxOutput.options.reasoningEffort = "max"
    const hookInput = {
      sessionID: "ambiguous-session",
      agent: "build",
      provider: {},
      message,
      model
    }

    await hooks["chat.params"]?.(hookInput as never, ultraOutput as never)
    await hooks["chat.params"]?.(hookInput as never, maxOutput as never)

    for (let index = 0; index < 2; index += 1) {
      const headers = { headers: {} as Record<string, unknown> }
      await hooks["chat.headers"]?.(hookInput as never, headers as never)
      expect(headers.headers["x-opencode-ultra-state"]).toBeUndefined()
    }
  })

  it("retains proactive child policy when collaboration headers are unavailable", async () => {
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
      ultraEnabled: true,
      catalogModels: [eligibleModel()],
      ultraState: resolveUltraSelection({ reasoningEffort: "ultra", model: eligibleModel(), childTask: true })
    })

    expect(transformed.ultra?.delegationPolicy).toBe("proactive")
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
      ultraEnabled: true,
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
      ultraEnabled: true,
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
