import { describe, expect, it } from "vitest"

import {
  applyPromptCacheKeyOverrideToRequest,
  remapDeveloperMessagesToUserOnRequest,
  sanitizeOutboundRequestIfNeeded,
  transformOutboundRequestPayload,
  stripReasoningReplayFromRequest
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
      promptCacheKeyOverride: "pk_project"
    })

    expect(transformed.changed).toBe(true)
    expect(transformed.replay.reason).toBe("updated")
    expect(transformed.replay.removedPartCount).toBe(1)
    expect(transformed.developerRoleRemap.reason).toBe("updated")
    expect(transformed.developerRoleRemap.remappedCount).toBe(1)
    expect(transformed.promptCacheKey.reason).toBe("set")
    expect(transformed.compatSanitizer.changed).toBe(false)

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
      promptCacheKeyOverride: "pk_project"
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
