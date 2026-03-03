import { describe, expect, it } from "vitest"

import type { CodexModelInfo } from "../lib/model-catalog.js"
import { applyRequestTransformPipeline } from "../lib/codex-native/request-transform-pipeline.js"

const CATALOG_MODELS: CodexModelInfo[] = [
  {
    slug: "gpt-5.3-codex",
    base_instructions: "Pipeline catalog instructions"
  }
]

describe("request transform pipeline", () => {
  it("applies real catalog instruction override in codex mode and detects subagent headers", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-openai-subagent": " worker "
      },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }]
      })
    })

    const result = await applyRequestTransformPipeline({
      request,
      spoofMode: "codex",
      remapDeveloperMessagesToUserEnabled: true,
      catalogModels: CATALOG_MODELS
    })

    const body = JSON.parse(await result.request.text()) as { instructions?: string }

    expect(result.instructionOverride.changed).toBe(true)
    expect(result.instructionOverride.reason).toBe("updated")
    expect(body.instructions).toBe("Pipeline catalog instructions")
    expect(result.subagentHeader).toBe("worker")
    expect(result.isSubagentRequest).toBe(true)
    expect(result.developerRoleRemap.reason).toBe("deferred_to_payload_transform")
  })

  it("keeps request unchanged in native mode", async () => {
    const payload = {
      model: "gpt-5.3-codex",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }]
    }
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    })

    const result = await applyRequestTransformPipeline({
      request,
      spoofMode: "native",
      remapDeveloperMessagesToUserEnabled: false,
      catalogModels: CATALOG_MODELS
    })

    const body = JSON.parse(await result.request.text()) as { instructions?: string; model: string }

    expect(result.instructionOverride.changed).toBe(false)
    expect(result.instructionOverride.reason).toBe("disabled")
    expect(body.model).toBe(payload.model)
    expect(body.instructions).toBeUndefined()
    expect(result.isSubagentRequest).toBe(false)
    expect(result.subagentHeader).toBeUndefined()
    expect(result.developerRoleRemap.reason).toBe("disabled")
  })
})
