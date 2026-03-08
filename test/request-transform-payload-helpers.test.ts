import { describe, expect, it } from "vitest"

import {
  applyPromptCacheKeyOverrideToPayload,
  remapDeveloperMessagesToUserOnPayload,
  stripReasoningReplayFromPayload
} from "../lib/codex-native/request-transform-payload-helpers.js"

describe("request transform payload helpers", () => {
  it("strips top-level reasoning replay parts and nested reasoning_content fields", () => {
    const payload: Record<string, unknown> = {
      input: [
        { type: "reasoning", text: "hidden" },
        {
          role: "assistant",
          content: [
            { type: "output_text", text: "visible", reasoning_content: "secret" },
            { type: "reasoning_summary", text: "internal" }
          ]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: "hi" }],
          reasoning_content: "also secret"
        }
      ]
    }

    const result = stripReasoningReplayFromPayload(payload)

    expect(result).toEqual({
      changed: true,
      reason: "updated",
      removedPartCount: 2,
      removedFieldCount: 2
    })
    expect(payload).toEqual({
      input: [
        {
          role: "assistant",
          content: [{ type: "output_text", text: "visible" }]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: "hi" }]
        }
      ]
    })
  })

  it("preserves structured policy developer messages while remapping plain developer messages", () => {
    const payload: Record<string, unknown> = {
      input: [
        {
          role: "developer",
          content: [{ type: "input_text", text: "<environment_context>\nApproval policy: never\nDo not prompt." }]
        },
        {
          role: "developer",
          content: [{ type: "input_text", text: "Write the answer as a haiku." }]
        }
      ]
    }

    const result = remapDeveloperMessagesToUserOnPayload(payload)

    expect(result).toEqual({
      changed: true,
      reason: "updated",
      remappedCount: 1,
      preservedCount: 1
    })
    const roles = (payload.input as Array<{ role: string }>).map((item) => item.role)
    expect(roles).toEqual(["developer", "user"])
  })

  it("reports permissions-only when all developer messages must be preserved", () => {
    const payload: Record<string, unknown> = {
      input: [
        {
          role: "developer",
          content: [{ type: "input_text", text: "<permissions instructions>\nMust not use network." }]
        }
      ]
    }

    expect(remapDeveloperMessagesToUserOnPayload(payload)).toEqual({
      changed: false,
      reason: "permissions_only",
      remappedCount: 0,
      preservedCount: 1
    })
  })

  it("sets, replaces, and no-ops prompt cache key overrides", () => {
    const payload: Record<string, unknown> = {}
    expect(applyPromptCacheKeyOverrideToPayload(payload, "cache-a")).toEqual({
      changed: true,
      reason: "set"
    })
    expect(payload.prompt_cache_key).toBe("cache-a")
    expect(applyPromptCacheKeyOverrideToPayload(payload, "cache-b")).toEqual({
      changed: true,
      reason: "replaced"
    })
    expect(applyPromptCacheKeyOverrideToPayload(payload, "cache-b")).toEqual({
      changed: false,
      reason: "already_matches"
    })
  })
})
