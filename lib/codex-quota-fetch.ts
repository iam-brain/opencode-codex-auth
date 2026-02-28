import type { CodexLimit, CodexRateLimitSnapshot } from "./types.js"
import type { Logger } from "./logger.js"

const DEFAULT_CHATGPT_BASE_URL = "https://chatgpt.com/backend-api"
const WHAM_USAGE_PATH = "/wham/usage"
const CODEX_USAGE_PATH = "/api/codex/usage"
const DEFAULT_FETCH_TIMEOUT_MS = 5000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return value
}

function toEpochMs(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (value <= 0) return undefined
  return value < 2_000_000_000 ? value * 1000 : value
}

function normalizePct(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined
  if (value < 0 || value > 100) return undefined
  return Math.round(value)
}

function parseWindowLimit(name: string, windowData: unknown): CodexLimit | null {
  if (!isRecord(windowData)) return null
  const usedPct = asNumber(windowData.used_percent)
  if (usedPct === undefined) return null
  const leftPct = normalizePct(100 - usedPct)
  if (leftPct === undefined) return null
  const resetsAt = toEpochMs(asNumber(windowData.reset_at ?? windowData.resets_at))
  return {
    name,
    leftPct,
    ...(resetsAt ? { resetsAt } : null)
  }
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value !== "boolean") return undefined
  return value
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeBaseUrl(baseUrl: string): string {
  let normalized = baseUrl.trim()
  while (normalized.endsWith("/")) normalized = normalized.slice(0, -1)

  if (
    (normalized.startsWith("https://chatgpt.com") || normalized.startsWith("https://chat.openai.com")) &&
    !normalized.includes("/backend-api")
  ) {
    normalized = `${normalized}/backend-api`
  }

  return normalized
}

function resolveQuotaUsageUrl(baseUrl?: string): string {
  const normalized = normalizeBaseUrl(baseUrl ?? DEFAULT_CHATGPT_BASE_URL)
  const useChatGptPathStyle = normalized.includes("/backend-api")
  return `${normalized}${useChatGptPathStyle ? WHAM_USAGE_PATH : CODEX_USAGE_PATH}`
}

function snapshotFromUsagePayload(input: {
  payload: unknown
  now: number
  modelFamily: string
}): CodexRateLimitSnapshot | null {
  if (!isRecord(input.payload)) return null

  const rateLimit = isRecord(input.payload.rate_limit) ? input.payload.rate_limit : null
  const primary = rateLimit?.primary_window ?? (isRecord(input.payload.primary) ? input.payload.primary : null)
  const secondary = rateLimit?.secondary_window ?? (isRecord(input.payload.secondary) ? input.payload.secondary : null)

  const limits: CodexLimit[] = []
  const primaryLimit = parseWindowLimit("requests", primary)
  if (primaryLimit) limits.push(primaryLimit)

  const secondaryLimit = parseWindowLimit("tokens", secondary)
  if (secondaryLimit) limits.push(secondaryLimit)

  if (limits.length === 0 && Array.isArray(input.payload.limits)) {
    for (const entry of input.payload.limits) {
      if (!isRecord(entry)) continue
      const name = typeof entry.name === "string" ? entry.name.toLowerCase() : "requests"
      const leftPctDirect = asNumber(entry.leftPct ?? entry.left_pct)
      const usedPct = asNumber(entry.used_percent)
      const remaining = asNumber(entry.remaining)
      const total = asNumber(entry.limit)
      const computedLeftPct =
        leftPctDirect ??
        (usedPct !== undefined
          ? 100 - usedPct
          : remaining !== undefined && total !== undefined && total > 0
            ? (remaining / total) * 100
            : undefined)
      if (computedLeftPct === undefined) continue
      const leftPct = normalizePct(computedLeftPct)
      if (leftPct === undefined) continue
      limits.push({
        name,
        leftPct,
        ...(toEpochMs(asNumber(entry.reset_at ?? entry.resets_at))
          ? {
              resetsAt: toEpochMs(asNumber(entry.reset_at ?? entry.resets_at))
            }
          : null)
      })
    }
  }

  if (limits.length === 0) return null

  const creditsSource = isRecord(input.payload.credits) ? input.payload.credits : null
  const credits =
    creditsSource &&
    (asBoolean(creditsSource.has_credits) !== undefined ||
      asBoolean(creditsSource.unlimited) !== undefined ||
      asString(creditsSource.balance) !== undefined)
      ? {
          hasCredits: asBoolean(creditsSource.has_credits),
          unlimited: asBoolean(creditsSource.unlimited),
          balance: asString(creditsSource.balance)
        }
      : undefined

  return {
    updatedAt: input.now,
    modelFamily: input.modelFamily,
    limits,
    ...(credits ? { credits } : null)
  }
}

export async function fetchQuotaSnapshotFromBackend(input: {
  accessToken: string
  accountId?: string
  baseUrl?: string
  now?: number
  modelFamily?: string
  userAgent?: string
  log?: Logger
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<CodexRateLimitSnapshot | null> {
  const endpoint = resolveQuotaUsageUrl(input.baseUrl)
  const fetchImpl = input.fetchImpl ?? fetch
  const timeoutMs = Math.max(1, Math.floor(input.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS))

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetchImpl(endpoint, {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        ...(input.accountId ? { "ChatGPT-Account-Id": input.accountId } : {}),
        Accept: "application/json",
        "User-Agent": input.userAgent ?? "codex_cli_rs"
      },
      signal: controller.signal
    }).finally(() => clearTimeout(timeout))

    if (!response.ok) {
      input.log?.debug("quota fetch failed", {
        endpoint,
        status: response.status
      })
      return null
    }

    const payload = (await response.json()) as unknown
    return snapshotFromUsagePayload({
      payload,
      now: input.now ?? Date.now(),
      modelFamily: input.modelFamily ?? "codex"
    })
  } catch (error) {
    input.log?.debug("quota fetch failed", {
      endpoint,
      error: error instanceof Error ? error.message : String(error)
    })
  }

  return null
}
