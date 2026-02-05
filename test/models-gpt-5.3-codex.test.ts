import { describe, expect, it } from "vitest"

import { CodexAuthPlugin } from "../lib/codex-native"

describe("codex-native model allowlist", () => {
  it("adds gpt-5.3-codex from gpt-5.2-codex and filters other models", async () => {
    const hooks = await CodexAuthPlugin({} as any)
    const provider = {
      models: {
        "gpt-5.2-codex": { instructions: "TEMPLATE" },
        "o3-mini": { id: "o3-mini" }
      }
    }

    const loader = hooks.auth?.loader
    if (!loader) throw new Error("Missing auth loader")

    await loader(
      async () => ({ type: "oauth", refresh: "", access: "", expires: 0 } as any),
      provider as any
    )

    expect(provider.models["gpt-5.3-codex"]).toBeDefined()
    expect(provider.models["gpt-5.3-codex"].instructions).toBe("TEMPLATE")
    expect(provider.models["o3-mini"]).toBeUndefined()
  })
})
