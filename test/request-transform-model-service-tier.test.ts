import { describe, expect, it } from "vitest"

import {
  getModelServiceTierOverride,
  resolveServiceTierForModel
} from "../lib/codex-native/request-transform-model-service-tier.js"

describe("request transform model service tier resolution", () => {
  it("passes configured global service tiers through without client-side model gating", () => {
    expect(
      resolveServiceTierForModel({
        behaviorSettings: {
          global: {
            serviceTier: "priority"
          }
        },
        modelCandidates: ["gpt-5.3-codex"],
        variantCandidates: []
      })
    ).toBe("priority")

    expect(
      resolveServiceTierForModel({
        behaviorSettings: {
          global: {
            serviceTier: "flex"
          }
        },
        modelCandidates: ["gpt-5-chat-latest"],
        variantCandidates: []
      })
    ).toBe("flex")
  })

  it("resolves variant and per-model overrides before global settings", () => {
    expect(
      resolveServiceTierForModel({
        behaviorSettings: {
          global: {
            serviceTier: "flex"
          },
          perModel: {
            "gpt-5.4": {
              serviceTier: "priority",
              variants: {
                high: {
                  serviceTier: "flex"
                }
              }
            }
          }
        },
        modelCandidates: ["gpt-5.4"],
        variantCandidates: ["high"]
      })
    ).toBe("flex")

    expect(
      resolveServiceTierForModel({
        behaviorSettings: {
          global: {
            serviceTier: "flex"
          },
          perModel: {
            "gpt-5.4": {
              serviceTier: "priority"
            }
          }
        },
        modelCandidates: ["gpt-5.4"],
        variantCandidates: []
      })
    ).toBe("priority")
  })

  it("matches suffixed model ids to base-slug overrides", () => {
    expect(
      getModelServiceTierOverride(
        {
          perModel: {
            "gpt-5.4": {
              variants: {
                high: {
                  serviceTier: "priority"
                }
              }
            }
          }
        },
        ["gpt-5.4-high"],
        ["high"]
      )
    ).toBe("priority")
  })
})
