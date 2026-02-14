import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

type UpstreamWatchConfig = {
  sources?: Array<{ files?: Array<{ path?: string }> }>
}

describe("upstream watch coverage", () => {
  it("tracks codex + openai auth/model/error pipeline files", () => {
    const watchPath = join(process.cwd(), "docs", "development", "upstream-watch.json")
    const parsed = JSON.parse(readFileSync(watchPath, "utf8")) as UpstreamWatchConfig
    const tracked = new Set(
      (parsed.sources ?? [])
        .flatMap((source) => source.files ?? [])
        .map((entry) => entry.path)
        .filter((value): value is string => !!value)
    )

    expect(tracked.has("packages/opencode/src/plugin/codex.ts")).toBe(true)
    expect(tracked.has("packages/opencode/src/plugin/index.ts")).toBe(true)
    expect(tracked.has("packages/opencode/src/provider/provider.ts")).toBe(true)
    expect(tracked.has("packages/opencode/src/provider/auth.ts")).toBe(true)
    expect(tracked.has("packages/opencode/src/provider/transform.ts")).toBe(true)
    expect(tracked.has("packages/opencode/src/provider/models.ts")).toBe(true)
    expect(tracked.has("packages/opencode/src/provider/error.ts")).toBe(true)
    expect(tracked.has("packages/opencode/src/session/message-v2.ts")).toBe(true)
    expect(tracked.has("codex-rs/core/models.json")).toBe(true)
    expect(tracked.has("codex-rs/core/src/auth.rs")).toBe(true)
    expect(tracked.has("codex-rs/core/src/client.rs")).toBe(true)
    expect(tracked.has("codex-rs/core/src/codex.rs")).toBe(true)
    expect(tracked.has("codex-rs/core/src/compact.rs")).toBe(true)
  })
})
