import { describe, expect, it } from "vitest"
import { resolveCodexOriginator } from "../lib/codex-native/originator"

describe("codex originator run detection", () => {
  it("detects run invocation when option values precede run", () => {
    const argv = ["/usr/bin/node", "/usr/bin/opencode", "--profile", "prod", "run", "echo", "hello"]
    expect(resolveCodexOriginator("codex", argv)).toBe("codex_exec")
  })

  it("does not classify non-run commands as run invocation", () => {
    const argv = ["/usr/bin/node", "/usr/bin/opencode", "--profile", "prod", "chat"]
    expect(resolveCodexOriginator("codex", argv)).toBe("codex_cli_rs")
  })
})
