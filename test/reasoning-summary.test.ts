import { describe, expect, it } from "vitest"

import {
  inspectReasoningSummaryValue,
  resolveReasoningSummaryValue,
  toReasoningSummaryPluginFatalError
} from "../lib/codex-native/reasoning-summary.js"

describe("reasoning summary helpers", () => {
  it("classifies absent, disabled, valid, and invalid values", () => {
    expect(inspectReasoningSummaryValue(undefined)).toEqual({ state: "absent" })
    expect(inspectReasoningSummaryValue(" none ")).toEqual({ state: "disabled", raw: "none" })
    expect(inspectReasoningSummaryValue("CONCISE")).toEqual({
      state: "valid",
      raw: "CONCISE",
      value: "concise"
    })
    expect(inspectReasoningSummaryValue("experimental")).toEqual({
      state: "invalid",
      raw: "experimental"
    })
  })

  it("returns request-option diagnostics for invalid explicit and configured values", () => {
    expect(
      resolveReasoningSummaryValue({
        explicitValue: "experimental",
        explicitSource: "request.reasoning.summary",
        hasReasoning: true,
        defaultReasoningSummarySource: "codexRuntimeDefaults.reasoningSummaryFormat"
      })
    ).toEqual({
      diagnostic: {
        actual: "experimental",
        source: "request.reasoning.summary",
        sourceType: "request_option"
      }
    })

    expect(
      resolveReasoningSummaryValue({
        explicitSource: "request.reasoning.summary",
        hasReasoning: true,
        configuredValue: "invalid",
        configuredSource: "config.reasoningSummary",
        defaultReasoningSummarySource: "codexRuntimeDefaults.reasoningSummaryFormat"
      })
    ).toEqual({
      diagnostic: {
        actual: "invalid",
        source: "config.reasoningSummary",
        sourceType: "request_option"
      }
    })
  })

  it("returns catalog diagnostics for invalid runtime defaults and defaults to auto otherwise", () => {
    expect(
      resolveReasoningSummaryValue({
        explicitSource: "request.reasoning.summary",
        hasReasoning: true,
        supportsReasoningSummaries: true,
        defaultReasoningSummaryFormat: "experimental",
        defaultReasoningSummarySource: "codexRuntimeDefaults.reasoningSummaryFormat",
        model: "gpt-5.3-codex"
      })
    ).toEqual({
      diagnostic: {
        actual: "experimental",
        model: "gpt-5.3-codex",
        source: "codexRuntimeDefaults.reasoningSummaryFormat",
        sourceType: "catalog_default"
      }
    })

    expect(
      resolveReasoningSummaryValue({
        explicitSource: "request.reasoning.summary",
        hasReasoning: true,
        supportsReasoningSummaries: true,
        defaultReasoningSummarySource: "codexRuntimeDefaults.reasoningSummaryFormat"
      })
    ).toEqual({ value: "auto" })
  })

  it("builds source-aware plugin errors for request and catalog failures", () => {
    const requestError = toReasoningSummaryPluginFatalError({
      actual: "experimental",
      source: "request.reasoning.summary",
      sourceType: "request_option"
    })
    expect(requestError.message).toContain("request setting `request.reasoning.summary`")
    expect(requestError.hint).toContain("Update the request")

    const catalogError = toReasoningSummaryPluginFatalError({
      actual: "experimental",
      model: "gpt-5.3-codex",
      source: "codexRuntimeDefaults.reasoningSummaryFormat",
      sourceType: "catalog_default"
    })
    expect(catalogError.message).toContain("selected model catalog default")
    expect(catalogError.message).toContain("gpt-5.3-codex")
    expect(catalogError.hint).toContain('reasoningSummary: "none"')
  })
})
