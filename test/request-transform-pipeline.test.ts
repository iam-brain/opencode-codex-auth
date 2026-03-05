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

  it("defers service_tier mutation to the payload transform stage", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        model_context_window: 1_000_000,
        model_auto_compact_token_limit: 900_000,
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }]
      })
    })

    const result = await applyRequestTransformPipeline({
      request,
      spoofMode: "codex",
      remapDeveloperMessagesToUserEnabled: false,
      catalogModels: CATALOG_MODELS,
      behaviorSettings: {
        global: {
          serviceTier: "priority"
        }
      }
    })

    const body = JSON.parse(await result.request.text()) as {
      service_tier?: string
      model_context_window?: number
      model_auto_compact_token_limit?: number
    }

    expect(result.serviceTierOverride.changed).toBe(false)
    expect(result.serviceTierOverride.reason).toBe("deferred_to_payload_transform")
    expect(body.service_tier).toBeUndefined()
    expect(body.model_context_window).toBe(1_000_000)
    expect(body.model_auto_compact_token_limit).toBe(900_000)
  })

  it("leaves explicit request-body service_tier untouched in the pipeline stage", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        service_tier: "flex",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }]
      })
    })

    const result = await applyRequestTransformPipeline({
      request,
      spoofMode: "codex",
      remapDeveloperMessagesToUserEnabled: false,
      catalogModels: CATALOG_MODELS,
      behaviorSettings: {
        global: {
          serviceTier: "priority"
        }
      }
    })

    const body = JSON.parse(await result.request.text()) as { service_tier?: string }
    expect(result.serviceTierOverride.changed).toBe(false)
    expect(result.serviceTierOverride.reason).toBe("deferred_to_payload_transform")
    expect(body.service_tier).toBe("flex")
  })

  it("keeps service-tier handling deferred regardless of configured model support", async () => {
    const priorityRequest = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
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

    const priorityResult = await applyRequestTransformPipeline({
      request: priorityRequest,
      spoofMode: "codex",
      remapDeveloperMessagesToUserEnabled: false,
      catalogModels: CATALOG_MODELS,
      behaviorSettings: { global: { serviceTier: "priority" } }
    })
    const flexResult = await applyRequestTransformPipeline({
      request: flexRequest,
      spoofMode: "codex",
      remapDeveloperMessagesToUserEnabled: false,
      catalogModels: CATALOG_MODELS,
      behaviorSettings: { global: { serviceTier: "flex" } }
    })

    const priorityBody = JSON.parse(await priorityResult.request.text()) as { service_tier?: string }
    const flexBody = JSON.parse(await flexResult.request.text()) as { service_tier?: string }

    expect(priorityResult.serviceTierOverride.changed).toBe(false)
    expect(priorityResult.serviceTierOverride.reason).toBe("deferred_to_payload_transform")
    expect(priorityBody.service_tier).toBeUndefined()
    expect(flexResult.serviceTierOverride.changed).toBe(false)
    expect(flexResult.serviceTierOverride.reason).toBe("deferred_to_payload_transform")
    expect(flexBody.service_tier).toBeUndefined()
  })
})
