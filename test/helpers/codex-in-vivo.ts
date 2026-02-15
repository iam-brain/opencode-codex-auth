import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { CodexAuthPlugin } from "../../lib/codex-native"
import { defaultAuthPath } from "../../lib/paths"

type InVivoProbeInput = {
  hostInstructions: string
  personalityKey: string
  personalityText: string
  modelSlug?: string
  agent?: string
  collaborationProfileEnabled?: boolean
  orchestratorSubagentsEnabled?: boolean
  collaborationToolProfile?: "opencode" | "codex"
  stripModelOptionsBeforeParams?: boolean
  modelInstructionsFallback?: string
  omitModelIdentityBeforeParams?: boolean
}

type InVivoProbeOutput = {
  preflightInstructions: string | undefined
  outboundInstructions: string | undefined
  outboundUrl: string | undefined
  outboundOriginator: string | undefined
  outboundUserAgent: string | undefined
}

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
}

type FixtureAuthMulti = {
  openai?: {
    type?: string
    strategy?: string
    accounts?: Array<{
      identityKey?: string
      enabled?: boolean
      refresh?: string
      access?: string
      expires?: number
      accountId?: string
      email?: string
      plan?: string
    }>
    activeIdentityKey?: string
  }
}

async function writeCodexCapableAuthFromFixture(): Promise<void> {
  const fixtureRaw = await fs.readFile(fixturePath("auth-multi.json"), "utf8")
  const fixture = JSON.parse(fixtureRaw) as FixtureAuthMulti
  const source = fixture.openai?.accounts?.[0]
  if (!source?.identityKey || !source.refresh || !source.access) {
    throw new Error("auth-multi fixture missing required account fields")
  }

  const account = {
    identityKey: source.identityKey,
    enabled: source.enabled !== false,
    refresh: source.refresh,
    access: source.access,
    expires: Date.now() + 60 * 60 * 1000,
    accountId: source.accountId,
    email: source.email,
    plan: source.plan,
    authTypes: ["native", "codex"] as const
  }

  const auth = {
    openai: {
      type: "oauth" as const,
      strategy: fixture.openai?.strategy ?? "round_robin",
      accounts: [account],
      activeIdentityKey: source.identityKey,
      native: {
        strategy: fixture.openai?.strategy ?? "round_robin",
        accounts: [{ ...account, authTypes: ["native"] as const }],
        activeIdentityKey: source.identityKey
      },
      codex: {
        strategy: fixture.openai?.strategy ?? "round_robin",
        accounts: [{ ...account, authTypes: ["codex"] as const }],
        activeIdentityKey: source.identityKey
      }
    }
  }

  const filePath = defaultAuthPath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 })
}

export async function runCodexInVivoInstructionProbe(input: InVivoProbeInput): Promise<InVivoProbeOutput> {
  const modelSlug = input.modelSlug ?? "gpt-5.3-codex"
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-in-vivo-"))
  const previousEnv = {
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME
  }
  process.env.HOME = root
  process.env.XDG_CONFIG_HOME = path.join(root, ".config")
  process.env.XDG_DATA_HOME = path.join(root, ".local", "share")

  await writeCodexCapableAuthFromFixture()

  let outboundInstructions: string | undefined
  let outboundUrl: string | undefined
  let outboundOriginator: string | undefined
  let outboundUserAgent: string | undefined

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (requestInput: RequestInfo | URL, init?: RequestInit) => {
    const request = requestInput instanceof Request ? requestInput : new Request(requestInput, init)
    const url = request.url

    if (url.includes("/backend-api/codex/models")) {
      return new Response(
        JSON.stringify({
          models: [
            {
              slug: modelSlug,
              model_messages: {
                instructions_template: "Base {{ personality }}",
                instructions_variables: {
                  personalities: {
                    [input.personalityKey]: input.personalityText
                  },
                  personality_default: "Default voice"
                }
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    }

    if (url.includes("/backend-api/codex/responses")) {
      outboundUrl = url
      outboundOriginator = request.headers.get("originator") ?? undefined
      outboundUserAgent = request.headers.get("user-agent") ?? undefined
      const body = JSON.parse(await request.clone().text()) as { instructions?: unknown }
      outboundInstructions = typeof body.instructions === "string" ? body.instructions : undefined
      return new Response(JSON.stringify({ id: "resp_test", output: [] }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-remaining-requests": "99",
          "x-ratelimit-limit-requests": "100",
          "x-ratelimit-reset-requests": "60"
        }
      })
    }

    throw new Error(`Unexpected fetch URL: ${url}`)
  }

  try {
    const hooks = await CodexAuthPlugin({} as never, {
      spoofMode: "codex",
      behaviorSettings: { global: { personality: input.personalityKey } },
      collaborationProfileEnabled: input.collaborationProfileEnabled,
      orchestratorSubagentsEnabled: input.orchestratorSubagentsEnabled,
      collaborationToolProfile: input.collaborationToolProfile
    })

    const provider = {
      models: {
        [modelSlug]: { id: modelSlug }
      }
    } as never

    const loaded = await hooks.auth?.loader?.(
      async () => ({ type: "oauth", refresh: "rt_123", access: "at_123", expires: Date.now() + 60_000 }) as never,
      provider
    )

    if (!loaded?.fetch) {
      throw new Error("Auth loader did not return fetch handler")
    }

    const modelOptions =
      (provider as { models: Record<string, { options?: Record<string, unknown> }> }).models[modelSlug]?.options ?? {}

    const paramsOutput = {
      temperature: 0,
      topP: 1,
      topK: 0,
      options: {
        instructions: input.hostInstructions,
        include: ["web_search_call.action.sources"]
      }
    }

    await hooks["chat.params"]?.(
      {
        sessionID: "ses_vivo_1",
        agent: input.agent ?? "default",
        provider: {},
        message: {},
        model: {
          id: input.omitModelIdentityBeforeParams === true ? undefined : modelSlug,
          api: input.omitModelIdentityBeforeParams === true ? undefined : { id: modelSlug },
          instructions: input.modelInstructionsFallback,
          providerID: "openai",
          capabilities: { toolcall: true },
          options: input.stripModelOptionsBeforeParams === true ? {} : modelOptions
        }
      } as never,
      paramsOutput as never
    )

    const headersOutput = { headers: {} as Record<string, string> }
    await hooks["chat.headers"]?.(
      {
        sessionID: "ses_vivo_1",
        agent: "default",
        model: { providerID: "openai", options: { promptCacheKey: "ses_vivo_1" } }
      } as never,
      headersOutput as never
    )

    const headers = new Headers(headersOutput.headers)
    headers.set("content-type", "application/json")

    await loaded.fetch(
      new Request("https://api.openai.com/v1/responses", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: modelSlug,
          input: "ping",
          prompt_cache_key: "ses_vivo_1",
          instructions: paramsOutput.options.instructions
        })
      })
    )

    return {
      preflightInstructions:
        typeof paramsOutput.options.instructions === "string" ? paramsOutput.options.instructions : undefined,
      outboundInstructions,
      outboundUrl,
      outboundOriginator,
      outboundUserAgent
    }
  } finally {
    globalThis.fetch = originalFetch
    if (previousEnv.HOME === undefined) delete process.env.HOME
    else process.env.HOME = previousEnv.HOME
    if (previousEnv.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previousEnv.XDG_CONFIG_HOME
    if (previousEnv.XDG_DATA_HOME === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = previousEnv.XDG_DATA_HOME
    await fs.rm(root, { recursive: true, force: true }).catch(() => {})
  }
}
