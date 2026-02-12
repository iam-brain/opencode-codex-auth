import { describe, expect, it, vi } from "vitest"

describe("codex-native session affinity persistence", () => {
  it("skips affinity persistence for subagent requests", async () => {
    vi.resetModules()

    const auth = {
      openai: {
        type: "oauth",
        accounts: [
          {
            identityKey: "acc|user@example.com|plus",
            accountId: "acc",
            email: "user@example.com",
            plan: "plus",
            enabled: true,
            access: "at",
            refresh: "rt",
            expires: Date.now() + 60_000,
            authTypes: ["codex"]
          }
        ],
        activeIdentityKey: "acc|user@example.com|plus"
      }
    }

    const loadAuthStorage = vi.fn(async () => auth)
    const saveAuthStorage = vi.fn(
      async (
        _path: string | undefined,
        update: (
          current: Record<string, unknown>
        ) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void
      ) => {
        const current = structuredClone(auth) as Record<string, unknown>
        await update(current)
        return current
      }
    )
    const setAccountCooldown = vi.fn(async () => {})
    const getOpenAIOAuthDomain = vi.fn((current: Record<string, unknown>, mode: "native" | "codex") => {
      const openai = current.openai as { accounts?: unknown[]; activeIdentityKey?: string } | undefined
      if (!openai || !Array.isArray(openai.accounts)) return undefined
      const scoped = (openai.accounts as Array<{ authTypes?: string[] }>).filter((account) => {
        const authTypes = Array.isArray(account.authTypes) ? account.authTypes : ["native"]
        return authTypes.includes(mode)
      })
      if (scoped.length === 0) return undefined
      return { accounts: scoped, activeIdentityKey: openai.activeIdentityKey }
    })
    const ensureOpenAIOAuthDomain = vi.fn(
      (current: Record<string, unknown>, mode: "native" | "codex") =>
        getOpenAIOAuthDomain(current, mode) ?? { accounts: [] }
    )
    const listOpenAIOAuthDomains = vi.fn((current: Record<string, unknown>) =>
      (["native", "codex"] as const)
        .map((mode) => ({ mode, domain: getOpenAIOAuthDomain(current, mode) }))
        .filter((entry): entry is { mode: "native" | "codex"; domain: { accounts: unknown[] } } =>
          Boolean(entry.domain && Array.isArray(entry.domain.accounts))
        )
    )

    const saveSessionAffinity = vi.fn(async (_update: unknown, _filePath: string) => ({ version: 1 }))

    vi.doMock("../lib/storage", () => ({
      loadAuthStorage,
      saveAuthStorage,
      getOpenAIOAuthDomain,
      ensureOpenAIOAuthDomain,
      listOpenAIOAuthDomains,
      setAccountCooldown,
      shouldOfferLegacyTransfer: vi.fn(async () => false)
    }))
    vi.doMock("../lib/model-catalog", () => ({
      getCodexModelCatalog: vi.fn(async () => undefined),
      applyCodexCatalogToProviderModels: vi.fn(
        (input: { providerModels: Record<string, Record<string, unknown>> }) => input.providerModels
      ),
      resolveInstructionsForModel: vi.fn(() => undefined)
    }))
    vi.doMock("../lib/codex-status-storage", () => ({
      loadSnapshots: vi.fn(async () => ({})),
      saveSnapshots: vi.fn(
        async (_path: string, update: (current: Record<string, unknown>) => Record<string, unknown>) => update({})
      )
    }))
    const pruneSessionAffinitySnapshot = vi.fn(async () => 0)

    vi.doMock("../lib/session-affinity", () => ({
      loadSessionAffinity: vi.fn(async () => ({ version: 1 })),
      saveSessionAffinity,
      readSessionAffinitySnapshot: vi.fn(() => ({
        seenSessionKeys: new Map<string, number>(),
        stickyBySessionKey: new Map<string, string>(),
        hybridBySessionKey: new Map<string, string>()
      })),
      writeSessionAffinitySnapshot: vi.fn((current: { version: 1 }) => current),
      createSessionExistsFn: vi.fn(() => async () => true),
      pruneSessionAffinitySnapshot
    }))

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 }))
    )

    const { CodexAuthPlugin } = await import("../lib/codex-native")
    const hooks = await CodexAuthPlugin({} as never, { spoofMode: "codex" })
    const loader = hooks.auth?.loader
    if (!loader) throw new Error("Missing auth loader")

    const loaded = await loader(async () => ({ type: "oauth", refresh: "", access: "", expires: 0 }) as never, {
      models: { "gpt-5.2-codex": { id: "gpt-5.2-codex" } }
    } as never)

    const subagentRequest = new Request("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-openai-subagent": "plan",
        session_id: "ses_subagent_1"
      },
      body: JSON.stringify({
        model: "gpt-5.2-codex",
        input: "hi",
        prompt_cache_key: "ses_subagent_1"
      })
    })
    await loaded.fetch?.(subagentRequest)
    await Promise.resolve()
    expect(saveSessionAffinity).toHaveBeenCalledTimes(0)

    await loaded.fetch?.("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", session_id: "ses_normal_1" },
      body: JSON.stringify({
        model: "gpt-5.2-codex",
        input: "hello",
        prompt_cache_key: "ses_normal_1"
      })
    })

    await vi.waitFor(() => {
      expect(saveSessionAffinity.mock.calls.length).toBeGreaterThan(0)
    })

    expect(pruneSessionAffinitySnapshot).toHaveBeenCalled()
    const pruneOptions = pruneSessionAffinitySnapshot.mock.calls[0]?.[2] as { missingGraceMs?: number } | undefined
    expect((pruneOptions?.missingGraceMs ?? 0) > 0).toBe(true)
  })
})
