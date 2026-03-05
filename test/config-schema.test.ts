import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const schemaPath = new URL("../schemas/codex-config.schema.json", import.meta.url)

describe("codex config schema", () => {
  it("includes serviceTier for model behavior and model configs", () => {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
      $defs?: {
        modelBehavior?: {
          properties?: Record<string, { enum?: string[] }>
        }
        modelConfig?: {
          allOf?: Array<{
            properties?: Record<string, { enum?: string[] }>
          }>
        }
      }
    }

    const behaviorServiceTier = schema.$defs?.modelBehavior?.properties?.serviceTier?.enum
    const modelConfigServiceTier = schema.$defs?.modelConfig?.allOf?.[1]?.properties?.serviceTier?.enum

    expect(behaviorServiceTier).toEqual(["default", "priority", "flex"])
    expect(modelConfigServiceTier).toEqual(["default", "priority", "flex"])
  })
})
