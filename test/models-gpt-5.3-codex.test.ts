import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

async function withIsolatedHome<T>(fn: () => Promise<T>): Promise<T> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-models-home-"))
  const xdgConfig = path.join(home, ".config")
  await fs.mkdir(xdgConfig, { recursive: true })

  const prevHome = process.env.HOME
  const prevXdg = process.env.XDG_CONFIG_HOME
  process.env.HOME = home
  process.env.XDG_CONFIG_HOME = xdgConfig

  try {
    return await fn()
  } finally {
    if (prevHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = prevHome
    }
    if (prevXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = prevXdg
    }
  }
}

describe("codex-native model allowlist", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("adds codex models from fallback set and filters unrelated models", async () => {
    vi.resetModules()

    await withIsolatedHome(async () => {
      const { CodexAuthPlugin } = await import("../lib/codex-native")
      const hooks = await CodexAuthPlugin({} as any)
      const provider = {
        models: {
          "gpt-5.2-codex": { instructions: "TEMPLATE" },
          "o3-mini": { id: "o3-mini" }
        }
      }

      const loader = hooks.auth?.loader
      if (!loader) throw new Error("Missing auth loader")

      await loader(async () => ({ type: "oauth", refresh: "", access: "", expires: 0 }) as any, provider as any)

      expect(provider.models["gpt-5.3-codex"]).toBeDefined()
      expect(provider.models["gpt-5.3-codex"].instructions).toBe("TEMPLATE")
      expect(provider.models["o3-mini"]).toBeUndefined()
    })
  })

  it("uses server catalog when available", async () => {
    vi.resetModules()

    await withIsolatedHome(async () => {
      vi.doMock("../lib/storage", () => ({
        loadAuthStorage: vi.fn(async () => ({
          openai: {
            type: "oauth",
            accounts: [
              {
                identityKey: "acc|u@e.com|plus",
                accountId: "acc_123",
                enabled: true,
                access: "at",
                refresh: "rt",
                expires: Date.now() + 60_000
              }
            ],
            activeIdentityKey: "acc|u@e.com|plus"
          }
        })),
        getOpenAIOAuthDomain: vi.fn((auth: Record<string, unknown>, mode: "native" | "codex") => {
          const openai = auth.openai as { accounts?: unknown[]; activeIdentityKey?: string } | undefined
          if (!openai || !Array.isArray(openai.accounts)) return undefined
          const scoped = (openai.accounts as Array<{ authTypes?: string[] }>).filter((account) => {
            const authTypes = Array.isArray(account.authTypes) ? account.authTypes : ["native"]
            return authTypes.includes(mode)
          })
          if (scoped.length === 0) return undefined
          return { accounts: scoped, activeIdentityKey: openai.activeIdentityKey }
        }),
        ensureOpenAIOAuthDomain: vi.fn((auth: Record<string, unknown>, mode: "native" | "codex") => {
          const openai = auth.openai as { accounts?: unknown[]; activeIdentityKey?: string } | undefined
          if (openai && Array.isArray(openai.accounts)) {
            const scoped = (openai.accounts as Array<{ authTypes?: string[] }>).filter((account) => {
              const authTypes = Array.isArray(account.authTypes) ? account.authTypes : ["native"]
              return authTypes.includes(mode)
            })
            if (scoped.length > 0) return { accounts: scoped, activeIdentityKey: openai.activeIdentityKey }
          }
          return { accounts: [] }
        }),
        listOpenAIOAuthDomains: vi.fn((auth: Record<string, unknown>) => {
          const openai = auth.openai as { accounts?: unknown[]; activeIdentityKey?: string } | undefined
          if (!openai || !Array.isArray(openai.accounts)) return []
          const out: Array<{ mode: "native" | "codex"; domain: { accounts: unknown[]; activeIdentityKey?: string } }> =
            []
          for (const mode of ["native", "codex"] as const) {
            const scoped = (openai.accounts as Array<{ authTypes?: string[] }>).filter((account) => {
              const authTypes = Array.isArray(account.authTypes) ? account.authTypes : ["native"]
              return authTypes.includes(mode)
            })
            if (scoped.length > 0)
              out.push({ mode, domain: { accounts: scoped, activeIdentityKey: openai.activeIdentityKey } })
          }
          return out
        }),
        saveAuthStorage: vi.fn(),
        setAccountCooldown: vi.fn(),
        shouldOfferLegacyTransfer: vi.fn(async () => false)
      }))

      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL | Request) => {
          if (url.toString().includes("/codex/models")) {
            return new Response(
              JSON.stringify({
                models: [{ slug: "gpt-5.4-codex" }, { slug: "gpt-5.4-codex-mini" }]
              }),
              { status: 200 }
            )
          }
          return new Response("ok", { status: 200 })
        })
      )

      const module = await import("../lib/codex-native")
      const hooks = await module.CodexAuthPlugin({} as any)

      const provider = {
        models: {
          "gpt-5.2-codex": { instructions: "TEMPLATE" },
          "o3-mini": { id: "o3-mini" }
        }
      }

      const loader = hooks.auth?.loader
      if (!loader) throw new Error("Missing auth loader")

      await loader(async () => ({ type: "oauth", refresh: "", access: "", expires: 0 }) as any, provider as any)

      expect(provider.models["gpt-5.4-codex"]).toBeDefined()
      expect(provider.models["gpt-5.4-codex-mini"]).toBeDefined()
      expect(provider.models["o3-mini"]).toBeUndefined()
    })
  })
})
