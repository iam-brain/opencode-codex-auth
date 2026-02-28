import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

let tmpDir: string | undefined
const previousXdgConfigHome = process.env.XDG_CONFIG_HOME

afterEach(async () => {
  vi.doUnmock("../lib/ui/auth-menu-runner")
  vi.resetModules()
  if (previousXdgConfigHome === undefined) {
    delete process.env.XDG_CONFIG_HOME
  } else {
    process.env.XDG_CONFIG_HOME = previousXdgConfigHome
  }
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe("auth-menu flow integration", () => {
  it("toggles account state through real storage plumbing", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-auth-menu-flow-"))
    process.env.XDG_CONFIG_HOME = tmpDir

    const configRoot = path.join(tmpDir, "opencode")
    const authPath = path.join(configRoot, "codex-accounts.json")
    await fs.mkdir(configRoot, { recursive: true })
    await fs.writeFile(
      authPath,
      JSON.stringify(
        {
          openai: {
            type: "oauth",
            native: {
              strategy: "sticky",
              activeIdentityKey: "acc_1|user@example.com|plus",
              accounts: [
                {
                  identityKey: "acc_1|user@example.com|plus",
                  accountId: "acc_1",
                  email: "user@example.com",
                  plan: "plus",
                  enabled: true,
                  access: "access-token",
                  refresh: "refresh-token",
                  expires: Date.now() + 60_000
                }
              ]
            }
          }
        },
        null,
        2
      ),
      "utf8"
    )

    const runAuthMenuOnce = vi.fn(async (input: { accounts: Array<unknown>; handlers: { onToggleAccount: (account: unknown) => Promise<void> } }) => {
      const account = input.accounts[0]
      expect(account).toBeDefined()
      await input.handlers.onToggleAccount(account)
      return "exit" as const
    })

    vi.doMock("../lib/ui/auth-menu-runner", () => ({
      runAuthMenuOnce
    }))

    const { runInteractiveAuthMenu } = await import("../lib/codex-native/auth-menu-flow")
    const result = await runInteractiveAuthMenu({
      authMode: "native",
      allowExit: true,
      refreshQuotaSnapshotsForAuthMenu: async () => {}
    })

    expect(result).toBe("exit")
    expect(runAuthMenuOnce).toHaveBeenCalledTimes(1)

    const persisted = JSON.parse(await fs.readFile(authPath, "utf8")) as {
      openai?: { native?: { accounts?: Array<{ enabled?: boolean }> } }
    }
    expect(persisted.openai?.native?.accounts?.[0]?.enabled).toBe(false)
  })
})
