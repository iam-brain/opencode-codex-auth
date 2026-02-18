import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { pathToFileURL } from "node:url"

type RequestTransformModule = typeof import("../lib/codex-native/request-transform")
type LoaderModule = typeof import("../lib/codex-native/openai-loader-fetch")
type OrchestratorModule = typeof import("../lib/fetch-orchestrator")
type RotationModule = typeof import("../lib/rotation")
type AcquireAuthModule = typeof import("../lib/codex-native/acquire-auth")

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
  return sorted[idx]!
}

function fmt(v: number): number {
  return Number(v.toFixed(3))
}

async function importFromRoot<T>(root: string, relPath: string): Promise<T> {
  const fullPath = path.resolve(root, relPath)
  return (await import(pathToFileURL(fullPath).href)) as T
}

function buildPayload() {
  return {
    model: "gpt-5.3-codex",
    prompt_cache_key: "ses_perf",
    input: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "reasoning_summary", text: "remove" }, { type: "output_text", text: "keep" }]
      },
      {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "rewrite" }]
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }]
      }
    ]
  }
}

function buildRequest(): Request {
  return new Request("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      session_id: "ses_perf"
    },
    body: JSON.stringify(buildPayload())
  })
}

async function seedAuthStore(xdgConfigHome: string): Promise<string> {
  const dir = path.join(xdgConfigHome, "opencode")
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, "codex-accounts.json")
  const identityKey = "acc_1|user@example.com|plus"
  await fs.writeFile(
    filePath,
    `${JSON.stringify(
      {
        openai: {
          type: "oauth",
          native: {
            strategy: "sticky",
            activeIdentityKey: identityKey,
            accounts: [
              {
                identityKey,
                accountId: "acc_1",
                email: "user@example.com",
                plan: "plus",
                enabled: true,
                access: "access-token",
                refresh: "refresh-token",
                expires: Date.now() + 3600_000
              }
            ]
          }
        }
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  )
  return filePath
}

async function benchmarkPayloadTransforms(root: string, iterations: number): Promise<{
  legacy: { medianMs: number; p95Ms: number }
  singlePass?: { medianMs: number; p95Ms: number }
}> {
  const mod = await importFromRoot<RequestTransformModule>(root, "lib/codex-native/request-transform.ts")
  const legacyDurations: number[] = []
  for (let i = 0; i < iterations; i += 1) {
    const t0 = performance.now()
    const request = buildRequest()
    const replay = await mod.stripReasoningReplayFromRequest({ request, enabled: true })
    const remap = await mod.remapDeveloperMessagesToUserOnRequest({ request: replay.request, enabled: true })
    const prompt = await mod.applyPromptCacheKeyOverrideToRequest({
      request: remap.request,
      enabled: true,
      promptCacheKey: "pk_project"
    })
    await mod.sanitizeOutboundRequestIfNeeded(prompt.request, true)
    legacyDurations.push(performance.now() - t0)
  }

  const hasSinglePass = typeof (mod as Partial<RequestTransformModule>).transformOutboundRequestPayload === "function"
  if (!hasSinglePass) {
    return {
      legacy: {
        medianMs: fmt(median(legacyDurations)),
        p95Ms: fmt(p95(legacyDurations))
      }
    }
  }

  const singleDurations: number[] = []
  for (let i = 0; i < iterations; i += 1) {
    const t0 = performance.now()
    await mod.transformOutboundRequestPayload({
      request: buildRequest(),
      stripReasoningReplayEnabled: true,
      remapDeveloperMessagesToUserEnabled: true,
      compatInputSanitizerEnabled: true,
      promptCacheKeyOverrideEnabled: true,
      promptCacheKeyOverride: "pk_project"
    })
    singleDurations.push(performance.now() - t0)
  }

  return {
    legacy: {
      medianMs: fmt(median(legacyDurations)),
      p95Ms: fmt(p95(legacyDurations))
    },
    singlePass: {
      medianMs: fmt(median(singleDurations)),
      p95Ms: fmt(p95(singleDurations))
    }
  }
}

async function benchmarkAcquireAuthNoop(root: string, iterations: number): Promise<{
  medianMs: number
  p95Ms: number
  fileWritesDetected: number
}> {
  const acquireMod = await importFromRoot<AcquireAuthModule>(root, "lib/codex-native/acquire-auth.ts")

  const xdgConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-perf-xdg-"))
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = xdgConfigHome

  try {
    const authFilePath = await seedAuthStore(xdgConfigHome)
    const defaults = acquireMod.createAcquireOpenAIAuthInputDefaults()
    const durations: number[] = []
    let writes = 0
    let lastMtimeMs = (await fs.stat(authFilePath)).mtimeMs

    for (let i = 0; i < iterations; i += 1) {
      const t0 = performance.now()
      await acquireMod.acquireOpenAIAuth({
        authMode: "native",
        context: { sessionKey: "ses_perf_auth" },
        isSubagentRequest: false,
        stickySessionState: defaults.stickySessionState,
        hybridSessionState: defaults.hybridSessionState,
        seenSessionKeys: new Map<string, number>(),
        persistSessionAffinityState: () => {},
        pidOffsetEnabled: false
      })
      durations.push(performance.now() - t0)
      const currentMtimeMs = (await fs.stat(authFilePath)).mtimeMs
      if (currentMtimeMs !== lastMtimeMs) {
        writes += 1
        lastMtimeMs = currentMtimeMs
      }
    }

    return {
      medianMs: fmt(median(durations)),
      p95Ms: fmt(p95(durations)),
      fileWritesDetected: writes
    }
  } finally {
    if (previousXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome
    }
  }
}

async function benchmarkQuotaBlocking(root: string): Promise<{ latencyMs: number }> {
  const loaderMod = await importFromRoot<LoaderModule>(root, "lib/codex-native/openai-loader-fetch.ts")
  const orchestratorMod = await importFromRoot<OrchestratorModule>(root, "lib/fetch-orchestrator.ts")
  const rotationMod = await importFromRoot<RotationModule>(root, "lib/rotation.ts")

  const xdgConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-perf-quota-"))
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = xdgConfigHome
  await seedAuthStore(xdgConfigHome)

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url
    if (url.includes("/wham/usage")) {
      await new Promise((resolve) => setTimeout(resolve, 120))
      return new Response(
        JSON.stringify({
          rate_limit: {
            primary_window: { used_percent: 20, reset_at: 1_710_000_000 },
            secondary_window: { used_percent: 10, reset_at: 1_711_000_000 }
          }
        }),
        { status: 200 }
      )
    }

    return new Response("ok", { status: 200 })
  }) as typeof fetch

  try {
    const handler = loaderMod.createOpenAIFetchHandler({
      authMode: "native",
      spoofMode: "native",
      remapDeveloperMessagesToUserEnabled: false,
      quietMode: true,
      pidOffsetEnabled: false,
      headerTransformDebug: false,
      compatInputSanitizerEnabled: false,
      internalCollaborationModeHeader: "x-opencode-collaboration-mode-kind",
      requestSnapshots: {
        captureRequest: async () => {},
        captureResponse: async () => {}
      },
      sessionAffinityState: {
        orchestratorState: orchestratorMod.createFetchOrchestratorState(),
        stickySessionState: rotationMod.createStickySessionState(),
        hybridSessionState: rotationMod.createStickySessionState(),
        persistSessionAffinityState: () => {}
      },
      getCatalogModels: () => undefined,
      syncCatalogFromAuth: async () => undefined,
      setCooldown: async () => {},
      showToast: async () => {}
    })

    const t0 = performance.now()
    await handler("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        session_id: "ses_quota_profile"
      },
      body: JSON.stringify({ model: "gpt-5.3-codex", input: "hello" })
    })
    return { latencyMs: fmt(performance.now() - t0) }
  } finally {
    globalThis.fetch = originalFetch
    if (previousXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = previousXdgConfigHome
    }
  }
}

async function run(): Promise<void> {
  const iterations = Math.max(1, Number.parseInt(process.argv[2] ?? "300", 10) || 300)
  const baselineRoot = path.resolve(process.argv[3] ?? path.join(process.cwd(), "..", ".."))
  const optimizedRoot = path.resolve(process.argv[4] ?? process.cwd())

  const baseline = {
    transforms: await benchmarkPayloadTransforms(baselineRoot, iterations),
    acquireAuth: await benchmarkAcquireAuthNoop(baselineRoot, Math.max(50, Math.floor(iterations / 2))),
    quota: await benchmarkQuotaBlocking(baselineRoot)
  }

  const optimized = {
    transforms: await benchmarkPayloadTransforms(optimizedRoot, iterations),
    acquireAuth: await benchmarkAcquireAuthNoop(optimizedRoot, Math.max(50, Math.floor(iterations / 2))),
    quota: await benchmarkQuotaBlocking(optimizedRoot)
  }

  const baselineTransformMs = baseline.transforms.legacy.medianMs
  const optimizedTransformMs = optimized.transforms.singlePass?.medianMs ?? optimized.transforms.legacy.medianMs
  const transformGainPct =
    baselineTransformMs > 0 ? fmt(((baselineTransformMs - optimizedTransformMs) / baselineTransformMs) * 100) : 0

  const acquireGainPct =
    baseline.acquireAuth.medianMs > 0
      ? fmt(((baseline.acquireAuth.medianMs - optimized.acquireAuth.medianMs) / baseline.acquireAuth.medianMs) * 100)
      : 0

  const quotaLatencyGainPct =
    baseline.quota.latencyMs > 0
      ? fmt(((baseline.quota.latencyMs - optimized.quota.latencyMs) / baseline.quota.latencyMs) * 100)
      : 0

  console.log(
    JSON.stringify(
      {
        iterations,
        baseline,
        optimized,
        gains: {
          transformMedianGainPct: transformGainPct,
          acquireAuthMedianGainPct: acquireGainPct,
          quotaLatencyGainPct,
          acquireAuthWriteReduction:
            baseline.acquireAuth.fileWritesDetected - optimized.acquireAuth.fileWritesDetected
        }
      },
      null,
      2
    )
  )
}

void run()
