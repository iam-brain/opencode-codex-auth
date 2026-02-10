import type { CodexLimit, CodexRateLimitSnapshot } from "./types"
import type { Logger } from "./logger"

const WHAM_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
const CODEX_USAGE_URL = "https://api.openai.com/api/codex/usage"

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

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 100) return 100
  return Math.round(value)
}

function parseWindowLimit(name: string, windowData: unknown): CodexLimit | null {
  if (!isRecord(windowData)) return null
  const usedPct = asNumber(windowData.used_percent)
  if (usedPct === undefined) return null
  const leftPct = clampPct(100 - usedPct)
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

function snapshotFromUsagePayload(input: {
  payload: unknown
  now: number
  modelFamily: string
}): CodexRateLimitSnapshot | null {
  if (!isRecord(input.payload)) return null

  const rateLimit = isRecord(input.payload.rate_limit) ? input.payload.rate_limit : null
  const primary =
    rateLimit?.primary_window ??
    (isRecord(input.payload.primary) ? input.payload.primary : null)
  const secondary =
    rateLimit?.secondary_window ??
    (isRecord(input.payload.secondary) ? input.payload.secondary : null)

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
      limits.push({
        name,
        leftPct: clampPct(computedLeftPct),
        ...(toEpochMs(asNumber(entry.reset_at ?? entry.resets_at)) ? {
          resetsAt: toEpochMs(asNumber(entry.reset_at ?? entry.resets_at))
        } : null)
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
  now?: number
  modelFamily?: string
  userAgent?: string
  log?: Logger
}): Promise<CodexRateLimitSnapshot | null> {
  const isChatgptToken = input.accessToken.split(".").length === 3
  const endpoints = isChatgptToken
    ? [WHAM_USAGE_URL, CODEX_USAGE_URL]
    : [CODEX_USAGE_URL, WHAM_USAGE_URL]

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "OpenAI-Account-Id": input.accountId ?? "",
          Accept: "application/json",
          "User-Agent": input.userAgent ?? "codex_cli_rs",
          Origin: "https://chatgpt.com"
        }
      })

      if (!response.ok) continue

      const payload = (await response.json()) as unknown
      const snapshot = snapshotFromUsagePayload({
        payload,
        now: input.now ?? Date.now(),
        modelFamily: input.modelFamily ?? "gpt-5.3-codex"
      })
      if (snapshot) return snapshot
    } catch (error) {
      input.log?.debug("quota fetch failed", {
        endpoint,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return null
}
