import { describe, expect, it } from "vitest"

import type { BehaviorSettings } from "../lib/config.js"
import {
  applyPromptCacheKeyOverrideToRequest,
  remapDeveloperMessagesToUserOnRequest,
  sanitizeOutboundRequestIfNeeded,
  stripReasoningReplayFromRequest,
  stripStaleCatalogScopedDefaultsFromRequest,
  transformOutboundRequestPayload
} from "../lib/codex-native/request-transform"

describe("codex request role remap", () => {
  it("remaps non-permissions developer messages to user", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: "Instructions from AGENTS.md" }]
          },
          {
            type: "message",
            role: "developer",
            content: [
              {
                type: "input_text",
                text: "<permissions instructions>\nFilesystem sandboxing defines which files can be read or written"
              }
            ]
          },
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "hello" }]
          }
        ]
      })
    })

    const remapped = await remapDeveloperMessagesToUserOnRequest({
      request,
      enabled: true
    })

    expect(remapped.changed).toBe(true)
    expect(remapped.reason).toBe("updated")
    expect(remapped.remappedCount).toBe(1)
    expect(remapped.preservedCount).toBe(1)

    const body = JSON.parse(await remapped.request.text()) as {
      input: Array<{ role: string }>
    }
    expect(body.input.map((item) => item.role)).toEqual(["user", "developer", "user"])
  })

  it("preserves permissions-only developer messages", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "message",
            role: "developer",
            content: [
              {
                type: "input_text",
                text: "<permissions instructions>\nApproval policy is currently never"
              }
            ]
          }
        ]
      })
    })

    const remapped = await remapDeveloperMessagesToUserOnRequest({
      request,
      enabled: true
    })

    expect(remapped.changed).toBe(false)
    expect(remapped.reason).toBe("permissions_only")
    expect(remapped.remappedCount).toBe(0)
    expect(remapped.preservedCount).toBe(1)
  })

  it("preserves structured policy blocks even when exact marker phrasing differs", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "message",
            role: "developer",
            content: [
              {
                type: "input_text",
                text: "<runtime_policy>\nFilesystem sandbox mode must only read files from the workspace."
              }
            ]
          }
        ]
      })
    })

    const remapped = await remapDeveloperMessagesToUserOnRequest({
      request,
      enabled: true
    })

    expect(remapped.changed).toBe(false)
    expect(remapped.reason).toBe("permissions_only")
    expect(remapped.remappedCount).toBe(0)
    expect(remapped.preservedCount).toBe(1)
  })

  it("does nothing when remap is disabled", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: "Any developer message" }]
          }
        ]
      })
    })

    const remapped = await remapDeveloperMessagesToUserOnRequest({
      request,
      enabled: false
    })

    expect(remapped.changed).toBe(false)
    expect(remapped.reason).toBe("disabled")
    expect(remapped.remappedCount).toBe(0)
    expect(remapped.preservedCount).toBe(0)
  })

  it("preserves request metadata when body is rewritten", async () => {
    const controller = new AbortController()
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      mode: "cors",
      credentials: "include",
      keepalive: true,
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: "rewrite me" }]
          }
        ]
      })
    })

    const remapped = await remapDeveloperMessagesToUserOnRequest({
      request,
      enabled: true
    })

    expect(remapped.changed).toBe(true)
    expect(remapped.request.keepalive).toBe(true)
    expect(remapped.request.credentials).toBe("include")
    expect(remapped.request.mode).toBe("cors")

    controller.abort()
    expect(remapped.request.signal.aborted).toBe(true)
  })
})

describe("codex reasoning replay stripping", () => {
  it("removes assistant reasoning replay parts and fields", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "message",
            role: "assistant",
            content: [
              { type: "reasoning_summary", text: "secret summary" },
              { type: "output_text", text: "visible", reasoning_content: "should-strip" }
            ]
          },
          {
            type: "reasoning",
            summary: [{ text: "remove whole item" }]
          },
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "keep user input" }]
          }
        ],
        reasoning: {
          effort: "high",
          summary: "auto"
        }
      })
    })

    const stripped = await stripReasoningReplayFromRequest({ request, enabled: true })

    expect(stripped.changed).toBe(true)
    expect(stripped.reason).toBe("updated")
    expect(stripped.removedPartCount).toBe(2)
    expect(stripped.removedFieldCount).toBe(1)

    const body = JSON.parse(await stripped.request.text()) as {
      input: Array<{ role?: string; content?: Array<Record<string, unknown>> }>
      reasoning?: { effort?: string; summary?: string }
    }
    expect(body.input).toHaveLength(2)
    expect(body.input[0]?.role).toBe("assistant")
    expect(body.input[0]?.content).toEqual([{ type: "output_text", text: "visible" }])
    expect(body.reasoning).toEqual({ effort: "high", summary: "auto" })
  })

  it("is a no-op when payload has no reasoning replay artifacts", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "safe output" }]
          },
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "safe input" }]
          }
        ]
      })
    })

    const stripped = await stripReasoningReplayFromRequest({ request, enabled: true })

    expect(stripped.changed).toBe(false)
    expect(stripped.reason).toBe("no_reasoning_replay")
    expect(stripped.removedPartCount).toBe(0)
    expect(stripped.removedFieldCount).toBe(0)
  })
})

describe("request transform aggregation", () => {
  const priorityBehaviorSettings: BehaviorSettings = {
    global: {
      serviceTier: "priority"
    }
  }

  it("applies replay stripping, remap, prompt key override, and compat sanitization in one parse", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "message",
            role: "assistant",
            content: [
              { type: "reasoning_summary", text: "remove me" },
              { type: "output_text", text: "keep me" }
            ]
          },
          {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: "rewrite role" }]
          }
        ]
      })
    })

    const transformed = await transformOutboundRequestPayload({
      request,
      stripReasoningReplayEnabled: true,
      remapDeveloperMessagesToUserEnabled: true,
      compatInputSanitizerEnabled: true,
      promptCacheKeyOverrideEnabled: true,
      promptCacheKeyOverride: "pk_project",
      behaviorSettings: priorityBehaviorSettings
    })

    expect(transformed.changed).toBe(true)
    expect(transformed.replay.reason).toBe("updated")
    expect(transformed.replay.removedPartCount).toBe(1)
    expect(transformed.developerRoleRemap.reason).toBe("updated")
    expect(transformed.developerRoleRemap.remappedCount).toBe(1)
    expect(transformed.promptCacheKey.reason).toBe("set")
    expect(transformed.compatSanitizer.changed).toBe(false)
    expect(transformed.serviceTier.changed).toBe(false)
    expect(transformed.serviceTier.reason).toBe("handled_by_chat_params")

    const body = JSON.parse(await transformed.request.text()) as {
      input: Array<{ role?: string; content?: Array<{ type?: string; text?: string }> }>
      prompt_cache_key?: string
    }
    expect(body.prompt_cache_key).toBe("pk_project")
    expect(body.input).toHaveLength(2)
    expect(body.input[0]?.content).toEqual([{ type: "output_text", text: "keep me" }])
    expect(body.input[1]?.role).toBe("user")
  })

  it("matches legacy behavior when no changes are needed", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }]
      })
    })

    const aggregated = await transformOutboundRequestPayload({
      request,
      stripReasoningReplayEnabled: true,
      remapDeveloperMessagesToUserEnabled: true,
      compatInputSanitizerEnabled: true,
      promptCacheKeyOverrideEnabled: true,
      promptCacheKeyOverride: "pk_project",
      behaviorSettings: priorityBehaviorSettings
    })

    const body = JSON.parse(await aggregated.request.text()) as {
      model: string
      input: Array<{ type: string; role: string; content: Array<{ type: string; text: string }> }>
      prompt_cache_key?: string
      instructions?: string
    }

    expect(body).toEqual({
      model: "gpt-5.3-codex",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
      prompt_cache_key: "pk_project"
    })
    expect(body.instructions).toBeUndefined()
    expect(aggregated.replay.reason).toBe("no_reasoning_replay")
    expect(aggregated.developerRoleRemap.reason).toBe("no_developer_messages")
    expect(aggregated.promptCacheKey.reason).toBe("set")
    expect(aggregated.compatSanitizer.changed).toBe(false)
    expect(aggregated.serviceTier.changed).toBe(false)
    expect(aggregated.serviceTier.reason).toBe("handled_by_chat_params")
  })

  it("leaves service_tier alone on the main payload path", async () => {
    const preservedRequest = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        service_tier: "flex",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }]
      })
    })
    const flexRequest = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }]
      })
    })

    const preserved = await transformOutboundRequestPayload({
      request: preservedRequest,
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false,
      behaviorSettings: priorityBehaviorSettings
    })
    const flex = await transformOutboundRequestPayload({
      request: flexRequest,
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false,
      behaviorSettings: { global: { serviceTier: "flex" } }
    })

    const preservedBody = JSON.parse(await preserved.request.text()) as { service_tier?: string }
    const flexBody = JSON.parse(await flex.request.text()) as { service_tier?: string }

    expect(preserved.serviceTier.changed).toBe(false)
    expect(preserved.serviceTier.reason).toBe("handled_by_chat_params")
    expect(preservedBody.service_tier).toBe("flex")
    expect(flex.serviceTier.changed).toBe(false)
    expect(flex.serviceTier.reason).toBe("handled_by_chat_params")
    expect(flexBody.service_tier).toBeUndefined()
  })

  it("preserves canonical wire fields without injecting provider-option aliases", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        reasoning: {
          effort: "high",
          summary: "auto"
        },
        text: {
          verbosity: "medium"
        },
        parallel_tool_calls: false,
        include: ["reasoning.encrypted_content"],
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }]
      })
    })

    const transformed = await transformOutboundRequestPayload({
      request,
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false
    })

    const body = JSON.parse(await transformed.request.text()) as {
      reasoning?: { effort?: string; summary?: string }
      text?: { verbosity?: string }
      parallel_tool_calls?: boolean
      reasoningEffort?: string
      reasoningSummary?: string
      textVerbosity?: string
      applyPatchToolType?: string
      parallelToolCalls?: boolean
      include?: string[]
    }

    expect(body.reasoning).toEqual({ effort: "high", summary: "auto" })
    expect(body.text).toEqual({ verbosity: "medium" })
    expect(body.parallel_tool_calls).toBe(false)
    expect(body.reasoningEffort).toBeUndefined()
    expect(body.reasoningSummary).toBeUndefined()
    expect(body.textVerbosity).toBeUndefined()
    expect(body.applyPatchToolType).toBeUndefined()
    expect(body.parallelToolCalls).toBeUndefined()
    expect(body.include).toEqual(["reasoning.encrypted_content"])
  })

  it("keeps canonical wire payloads unchanged when no wire-level transform applies", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        reasoning: {
          effort: "minimal",
          summary: "none"
        },
        text: {
          verbosity: "high"
        },
        parallel_tool_calls: true,
        include: ["reasoning.encrypted_content"],
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }]
      })
    })

    const transformed = await transformOutboundRequestPayload({
      request,
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false
    })

    const body = JSON.parse(await transformed.request.text()) as {
      reasoning?: { effort?: string; summary?: string }
      text?: { verbosity?: string }
      parallel_tool_calls?: boolean
      include?: string[]
    }

    expect(body.reasoning).toEqual({ effort: "minimal", summary: "none" })
    expect(body.text).toEqual({ verbosity: "high" })
    expect(body.parallel_tool_calls).toBe(true)
    expect(body.include).toEqual(["reasoning.encrypted_content"])
  })
})

describe("compat sanitizer wrapper", () => {
  it("sanitizes payload and reports changed when enabled", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [
          {
            type: "message",
            role: "user",
            item_reference: { id: "should-strip" },
            content: [{ type: "input_text", text: "hello" }]
          }
        ]
      })
    })

    const sanitized = await sanitizeOutboundRequestIfNeeded(request, true)
    expect(sanitized.changed).toBe(true)

    const body = JSON.parse(await sanitized.request.text()) as {
      input: Array<Record<string, unknown>>
    }
    expect(body.input[0]).not.toHaveProperty("item_reference")
  })
})

describe("catalog-scoped payload cleanup", () => {
  const previousCatalogModels = [
    {
      slug: "gpt-5.3-codex",
      default_reasoning_level: "high",
      supports_reasoning_summaries: true,
      reasoning_summary_format: "auto",
      default_verbosity: "medium",
      supports_parallel_tool_calls: true,
      model_messages: {
        instructions_template: "Account A instructions"
      }
    }
  ]

  it("preserves explicit wire settings when failed-refresh cleanup cannot tie them to prior defaults", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        instructions: "Explicit request instructions",
        reasoning: {
          effort: "medium",
          summary: "detailed"
        },
        text: {
          verbosity: "high"
        },
        parallel_tool_calls: false,
        include: ["reasoning.encrypted_content", "web_search_call.action.sources"],
        input: "hello"
      })
    })

    const transformed = await stripStaleCatalogScopedDefaultsFromRequest({
      request,
      previousCatalogModels
    })

    expect(transformed.changed).toBe(false)
    const body = JSON.parse(await transformed.request.text()) as {
      instructions?: string
      reasoning?: { effort?: string; summary?: string }
      text?: { verbosity?: string }
      parallel_tool_calls?: boolean
      include?: string[]
    }
    expect(body.instructions).toBe("Explicit request instructions")
    expect(body.reasoning).toEqual({ effort: "medium", summary: "detailed" })
    expect(body.text).toEqual({ verbosity: "high" })
    expect(body.parallel_tool_calls).toBe(false)
    expect(body.include).toEqual(["reasoning.encrypted_content", "web_search_call.action.sources"])
  })

  it("strips stale reasoning summary and encrypted-content include when selected catalog refresh fails", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        instructions: "Account A instructions",
        reasoning: {
          effort: "high",
          summary: "auto"
        },
        text: {
          verbosity: "medium"
        },
        parallel_tool_calls: true,
        include: ["reasoning.encrypted_content", "web_search_call.action.sources"],
        input: "hello"
      })
    })

    const transformed = await stripStaleCatalogScopedDefaultsFromRequest({
      request,
      previousCatalogModels
    })

    expect(transformed.changed).toBe(true)
    const body = JSON.parse(await transformed.request.text()) as {
      instructions?: string
      reasoning?: { effort?: string; summary?: string }
      text?: { verbosity?: string }
      parallel_tool_calls?: boolean
      include?: string[]
    }
    expect(body.instructions).toBeUndefined()
    expect(body.reasoning).toBeUndefined()
    expect(body.text).toBeUndefined()
    expect(body.parallel_tool_calls).toBeUndefined()
    expect(body.include).toEqual(["web_search_call.action.sources"])
  })

  it("updates reasoning summary and encrypted-content include when the selected account changes", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        instructions: "Account A instructions",
        reasoning: {
          effort: "high",
          summary: "auto"
        },
        text: {
          verbosity: "medium"
        },
        parallel_tool_calls: true,
        include: ["reasoning.encrypted_content", "web_search_call.action.sources"],
        input: "hello"
      })
    })

    const transformed = await transformOutboundRequestPayload({
      request,
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false,
      requestCatalogScopeChanged: true,
      previousCatalogModels,
      catalogModels: [
        {
          slug: "gpt-5.3-codex",
          default_reasoning_level: "low",
          supports_reasoning_summaries: true,
          reasoning_summary_format: "concise",
          default_verbosity: "low",
          supports_parallel_tool_calls: false,
          model_messages: {
            instructions_template: "Account B instructions"
          }
        }
      ]
    })

    expect(transformed.changed).toBe(true)
    const body = JSON.parse(await transformed.request.text()) as {
      instructions?: string
      reasoning?: { effort?: string; summary?: string }
      text?: { verbosity?: string }
      parallel_tool_calls?: boolean
      include?: string[]
    }
    expect(body.instructions).toBe("Account B instructions")
    expect(body.reasoning).toEqual({ effort: "low", summary: "concise" })
    expect(body.text).toEqual({ verbosity: "low" })
    expect(body.parallel_tool_calls).toBe(false)
    expect(body.include).toEqual(["reasoning.encrypted_content", "web_search_call.action.sources"])
  })

  it("strips stale catalog instructions when the next account no longer renders safe instructions", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        instructions: "Account A instructions",
        reasoning: {
          effort: "high",
          summary: "auto"
        },
        text: {
          verbosity: "medium"
        },
        parallel_tool_calls: true,
        include: ["reasoning.encrypted_content"],
        input: "hello"
      })
    })

    const transformed = await transformOutboundRequestPayload({
      request,
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false,
      requestCatalogScopeChanged: true,
      previousCatalogModels,
      catalogModels: [
        {
          slug: "gpt-5.3-codex",
          default_reasoning_level: "low",
          supports_reasoning_summaries: true,
          reasoning_summary_format: "concise",
          default_verbosity: "low",
          supports_parallel_tool_calls: false,
          model_messages: {
            instructions_template: "{{ unsupported_marker }}"
          }
        }
      ]
    })

    expect(transformed.changed).toBe(true)
    const body = JSON.parse(await transformed.request.text()) as {
      instructions?: string
      reasoning?: { effort?: string; summary?: string }
      text?: { verbosity?: string }
      parallel_tool_calls?: boolean
      include?: string[]
    }
    expect(body.instructions).toBeUndefined()
    expect(body.reasoning).toEqual({ effort: "low", summary: "concise" })
    expect(body.text).toEqual({ verbosity: "low" })
    expect(body.parallel_tool_calls).toBe(false)
    expect(body.include).toEqual(["reasoning.encrypted_content"])
  })

  it("clears stale scoped defaults when the next catalog falls back to a minimal official model row", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        instructions: "Account A instructions",
        reasoning: {
          effort: "high",
          summary: "auto"
        },
        text: {
          verbosity: "medium"
        },
        parallel_tool_calls: true,
        include: ["reasoning.encrypted_content"],
        input: "hello"
      })
    })

    const transformed = await transformOutboundRequestPayload({
      request,
      stripReasoningReplayEnabled: false,
      remapDeveloperMessagesToUserEnabled: false,
      compatInputSanitizerEnabled: false,
      promptCacheKeyOverrideEnabled: false,
      requestCatalogScopeChanged: true,
      previousCatalogModels,
      catalogModels: [
        {
          slug: "gpt-5.3-codex",
          context_window: 272000,
          input_modalities: ["text"]
        }
      ]
    })

    expect(transformed.changed).toBe(true)
    const body = JSON.parse(await transformed.request.text()) as {
      instructions?: string
      reasoning?: { effort?: string; summary?: string }
      text?: { verbosity?: string }
      parallel_tool_calls?: boolean
      include?: string[]
    }
    expect(body.instructions).toBeUndefined()
    expect(body.reasoning).toBeUndefined()
    expect(body.text).toBeUndefined()
    expect(body.parallel_tool_calls).toBeUndefined()
    expect(body.include).toBeUndefined()
  })
})
