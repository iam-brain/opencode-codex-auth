import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { pathToFileURL } from "node:url"

type RequestTransformModule = typeof import("../lib/codex-native/request-transform.js")
type LoaderModule = typeof import("../lib/codex-native/openai-loader-fetch.js")
type OrchestratorModule = typeof import("../lib/fetch-orchestrator.js")
type RotationModule = typeof import("../lib/rotation.js")
type AcquireAuthModule = typeof import("../lib/codex-native/acquire-auth.js")

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
  const mod = await importFromRoot<RequestTransformModule>(root, "dist/lib/codex-native/request-transform.js")
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
  const acquireMod = await importFromRoot<AcquireAuthModule>(root, "dist/lib/codex-native/acquire-auth.js")

  const xdgConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-perf-xdg-"))
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = xdgConfigHome

  try {
    const authFilePath = await seedAuthStore(xdgConfigHome)
    const defaults = acquireMod.createAcquireOpenAIAuthInputDefaults()
    const durations: number[] = []
    let writes = 0
    let lastSnapshot = await fs.readFile(authFilePath, "utf8")

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
      const currentSnapshot = await fs.readFile(authFilePath, "utf8")
      if (currentSnapshot !== lastSnapshot) {
        writes += 1
        lastSnapshot = currentSnapshot
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
    await fs.rm(xdgConfigHome, { recursive: true, force: true })
  }
}

async function benchmarkQuotaBlocking(root: string): Promise<{ latencyMs: number }> {
  const loaderMod = await importFromRoot<LoaderModule>(root, "dist/lib/codex-native/openai-loader-fetch.js")
  const orchestratorMod = await importFromRoot<OrchestratorModule>(root, "dist/lib/fetch-orchestrator.js")
  const rotationMod = await importFromRoot<RotationModule>(root, "dist/lib/rotation.js")

  const xdgConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-perf-quota-"))
  const previousXdgConfigHome = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = xdgConfigHome
  await seedAuthStore(xdgConfigHome)

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
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

    return new Response(JSON.stringify({ id: "res_perf", output: [] }), {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    })
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
    await fs.rm(xdgConfigHome, { recursive: true, force: true })
  }
}

type ProfileResult = {
  transforms: Awaited<ReturnType<typeof benchmarkPayloadTransforms>>
  acquireAuth: Awaited<ReturnType<typeof benchmarkAcquireAuthNoop>>
  quota: Awaited<ReturnType<typeof benchmarkQuotaBlocking>>
}

async function collectProfile(root: string, iterations: number): Promise<ProfileResult> {
  return {
    transforms: await benchmarkPayloadTransforms(root, iterations),
    acquireAuth: await benchmarkAcquireAuthNoop(root, Math.max(50, Math.floor(iterations / 2))),
    quota: await benchmarkQuotaBlocking(root)
  }
}

function resolveTransformMedian(result: ProfileResult["transforms"]): number {
  return result.singlePass?.medianMs ?? result.legacy.medianMs
}

async function run(): Promise<void> {
  const iterations = Math.max(1, Number.parseInt(process.argv[2] ?? "300", 10) || 300)
  const baselineArg = process.argv[3]
  const optimizedArg = process.argv[4]
  const baselineRoot = path.resolve(baselineArg ?? process.cwd())
  const optimizedRoot = optimizedArg ? path.resolve(optimizedArg) : undefined
  const isComparativeMode = Boolean(optimizedRoot && optimizedRoot !== baselineRoot)

  if (!isComparativeMode) {
    const root = optimizedRoot ?? baselineRoot
    const profile = await collectProfile(root, iterations)
    console.log(
      JSON.stringify(
        {
          mode: "single-root",
          iterations,
          root,
          profile
        },
        null,
        2
      )
    )
    return
  }

  const comparativeOptimizedRoot = optimizedRoot as string
  const baseline = await collectProfile(baselineRoot, iterations)
  const optimized = await collectProfile(comparativeOptimizedRoot, iterations)

  const baselineTransformMs = resolveTransformMedian(baseline.transforms)
  const optimizedTransformMs = resolveTransformMedian(optimized.transforms)
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
        mode: "comparative",
        iterations,
        roots: {
          baseline: baselineRoot,
          optimized: comparativeOptimizedRoot
        },
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

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`perf-profile failed: ${message}\n`)
  process.exitCode = 1
})
