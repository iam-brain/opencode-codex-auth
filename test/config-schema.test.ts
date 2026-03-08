import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const schemaPath = new URL("../schemas/codex-config.schema.json", import.meta.url)

describe("codex config schema", () => {
  it("includes serviceTier for model behavior and model configs", () => {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
      $defs?: {
        serviceTier?: {
          enum?: string[]
        }
        modelBehavior?: {
          properties?: Record<string, { enum?: string[]; $ref?: string }>
        }
        modelConfig?: {
          allOf?: Array<{
            properties?: Record<string, { enum?: string[]; $ref?: string }>
          }>
        }
      }
    }

    const behaviorServiceTier =
      schema.$defs?.serviceTier?.enum ?? schema.$defs?.modelBehavior?.properties?.serviceTier?.enum
    const modelConfigServiceTier =
      schema.$defs?.serviceTier?.enum ?? schema.$defs?.modelConfig?.allOf?.[1]?.properties?.serviceTier?.enum

    expect(behaviorServiceTier).toEqual(["auto", "priority", "flex", "default"])
    expect(modelConfigServiceTier).toEqual(["auto", "priority", "flex", "default"])
  })

  it("defines customModels with required targetModel", () => {
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
      properties?: {
        customModels?: {
          additionalProperties?: {
            $ref?: string
          }
        }
      }
      $defs?: {
        customModel?: {
          required?: string[]
          properties?: Record<string, unknown>
        }
      }
    }

    expect(schema.properties?.customModels?.additionalProperties?.$ref).toBe("#/$defs/customModel")
    expect(schema.$defs?.customModel?.required).toContain("targetModel")
    expect(schema.$defs?.customModel?.properties).toHaveProperty("variants")
  })
})
