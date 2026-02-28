import { afterEach, describe, expect, it, vi } from "vitest"

describe("request transform pipeline", () => {
  afterEach(() => {
    vi.resetModules()
    vi.unmock("../lib/codex-native/request-transform.js")
  })

  it("enables catalog override in codex mode and detects subagent headers", async () => {
    const applyCatalogInstructionOverrideToRequest = vi.fn(
      async (input: { request: Request; enabled: boolean }) => ({
        request: input.request,
        changed: input.enabled,
        reason: input.enabled ? "updated" : "disabled"
      })
    )

    vi.doMock("../lib/codex-native/request-transform.js", () => ({
      applyCatalogInstructionOverrideToRequest
    }))

    const { applyRequestTransformPipeline } = await import("../lib/codex-native/request-transform-pipeline.js")

    const request = new Request("https://api.openai.com/v1/responses", {
      headers: { "x-openai-subagent": " worker " }
    })

    const result = await applyRequestTransformPipeline({
      request,
      spoofMode: "codex",
      remapDeveloperMessagesToUserEnabled: true,
      catalogModels: undefined
    })

    expect(applyCatalogInstructionOverrideToRequest).toHaveBeenCalledWith(
      expect.objectContaining({ request, enabled: true })
    )
    expect(result.subagentHeader).toBe("worker")
    expect(result.isSubagentRequest).toBe(true)
    expect(result.developerRoleRemap.reason).toBe("deferred_to_payload_transform")
  })

  it("disables catalog override in native mode", async () => {
    const applyCatalogInstructionOverrideToRequest = vi.fn(
      async (input: { request: Request; enabled: boolean }) => ({
        request: input.request,
        changed: input.enabled,
        reason: "disabled"
      })
    )

    vi.doMock("../lib/codex-native/request-transform.js", () => ({
      applyCatalogInstructionOverrideToRequest
    }))

    const { applyRequestTransformPipeline } = await import("../lib/codex-native/request-transform-pipeline.js")

    const request = new Request("https://api.openai.com/v1/responses")
    const result = await applyRequestTransformPipeline({
      request,
      spoofMode: "native",
      remapDeveloperMessagesToUserEnabled: false,
      catalogModels: undefined
    })

    expect(applyCatalogInstructionOverrideToRequest).toHaveBeenCalledWith(
      expect.objectContaining({ request, enabled: false })
    )
    expect(result.isSubagentRequest).toBe(false)
    expect(result.subagentHeader).toBeUndefined()
    expect(result.developerRoleRemap.reason).toBe("disabled")
  })
})
