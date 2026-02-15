import { describe, expect, it } from "vitest"

import { buildProjectPromptCacheKey, PROMPT_CACHE_KEY_VERSION } from "../lib/prompt-cache-key"
import { applyPromptCacheKeyOverrideToRequest } from "../lib/codex-native/request-transform"

describe("prompt cache key", () => {
  it("builds a stable versioned key per project path and mode", () => {
    const one = buildProjectPromptCacheKey({ projectPath: "/tmp/project", spoofMode: "native" })
    const two = buildProjectPromptCacheKey({ projectPath: "/tmp/project", spoofMode: "native" })

    expect(one).toBe(two)
    expect(one).toMatch(new RegExp(`^ocpk_v${PROMPT_CACHE_KEY_VERSION}_[a-f0-9]{24}$`))
  })

  it("changes when project path changes", () => {
    const one = buildProjectPromptCacheKey({ projectPath: "/tmp/project-one", spoofMode: "native" })
    const two = buildProjectPromptCacheKey({ projectPath: "/tmp/project-two", spoofMode: "native" })

    expect(one).not.toBe(two)
  })

  it("changes when mode changes", () => {
    const nativeKey = buildProjectPromptCacheKey({ projectPath: "/tmp/project", spoofMode: "native" })
    const codexKey = buildProjectPromptCacheKey({ projectPath: "/tmp/project", spoofMode: "codex" })

    expect(nativeKey).not.toBe(codexKey)
  })

  it("replaces prompt_cache_key in outbound request payload", async () => {
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        input: "hello",
        prompt_cache_key: "ses_original"
      })
    })

    const key = buildProjectPromptCacheKey({ projectPath: "/tmp/project", spoofMode: "codex" })
    const result = await applyPromptCacheKeyOverrideToRequest({
      request,
      enabled: true,
      promptCacheKey: key
    })
    const body = JSON.parse(await result.request.text()) as Record<string, unknown>

    expect(result.changed).toBe(true)
    expect(result.reason).toBe("replaced")
    expect(body.prompt_cache_key).toBe(key)
  })
})
