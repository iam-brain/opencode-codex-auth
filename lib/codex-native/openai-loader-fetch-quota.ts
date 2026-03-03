import { saveSnapshots } from "../codex-status-storage.js"
import { fetchQuotaSnapshotFromBackend } from "../codex-quota-fetch.js"
import type { Logger } from "../logger.js"
import { defaultSnapshotsPath } from "../paths.js"
import type { CodexSpoofMode } from "../config.js"
import {
  DEFAULT_QUOTA_THRESHOLD_TRACKER_STATE,
  evaluateQuotaThresholds,
  type QuotaThresholdTrackerState
} from "../quota-threshold-alerts.js"
import { resolveRequestUserAgent } from "./client-identity.js"
import { resolveCodexOriginator } from "./originator.js"
import {
  QUOTA_EXHAUSTED_FALLBACK_COOLDOWN_MS,
  QUOTA_FETCH_TIMEOUT_MS,
  QUOTA_REFRESH_FAILURE_RETRY_MS,
  QUOTA_REFRESH_TTL_MS
} from "./openai-loader-fetch-state.js"

export function scheduleQuotaRefresh(input: {
  identityForQuota: string
  selectedAuthForQuota: { access: string; accountId?: string }
  spoofMode: CodexSpoofMode
  log?: Logger
  quietMode: boolean
  quotaRefreshAtByIdentity: Map<string, number>
  quotaTrackerByIdentity: Map<string, QuotaThresholdTrackerState>
  setCooldown: (idKey: string, cooldownUntil: number) => Promise<void>
  showToast: (message: string, variant?: "info" | "success" | "warning" | "error", quietMode?: boolean) => Promise<void>
}): void {
  const now = Date.now()
  const nextRefreshAt = input.quotaRefreshAtByIdentity.get(input.identityForQuota)
  if (nextRefreshAt !== undefined && now < nextRefreshAt) {
    return
  }

  input.quotaRefreshAtByIdentity.set(input.identityForQuota, now + QUOTA_REFRESH_TTL_MS)
  void (async () => {
    try {
      const quotaSnapshot = await fetchQuotaSnapshotFromBackend({
        accessToken: input.selectedAuthForQuota.access,
        accountId: input.selectedAuthForQuota.accountId,
        now,
        modelFamily: "codex",
        userAgent: resolveRequestUserAgent(input.spoofMode, resolveCodexOriginator(input.spoofMode)),
        log: input.log,
        timeoutMs: QUOTA_FETCH_TIMEOUT_MS
      })

      if (!quotaSnapshot) {
        input.quotaRefreshAtByIdentity.set(input.identityForQuota, now + QUOTA_REFRESH_FAILURE_RETRY_MS)
        return
      }

      await saveSnapshots(defaultSnapshotsPath(), (current) => ({
        ...current,
        [input.identityForQuota]: quotaSnapshot
      }))

      const previousTracker =
        input.quotaTrackerByIdentity.get(input.identityForQuota) ?? DEFAULT_QUOTA_THRESHOLD_TRACKER_STATE
      const evaluated = evaluateQuotaThresholds({
        snapshot: quotaSnapshot,
        previousState: previousTracker
      })
      input.quotaTrackerByIdentity.set(input.identityForQuota, evaluated.nextState)

      for (const warning of evaluated.warnings) {
        await input.showToast(warning.message, "warning", input.quietMode)
      }

      if (evaluated.exhaustedCrossings.length > 0) {
        const nowForCooldown = Date.now()
        const cooldownCandidates = evaluated.exhaustedCrossings
          .map((crossing) => crossing.resetsAt)
          .filter(
            (value): value is number => typeof value === "number" && Number.isFinite(value) && value > nowForCooldown
          )
        const cooldownUntil =
          cooldownCandidates.length > 0
            ? Math.max(...cooldownCandidates)
            : nowForCooldown + QUOTA_EXHAUSTED_FALLBACK_COOLDOWN_MS
        await input.setCooldown(input.identityForQuota, cooldownUntil)

        if (evaluated.exhaustedCrossings.length === 1) {
          const only = evaluated.exhaustedCrossings[0]
          const label = only.window === "weekly" ? "weekly" : "5h"
          await input.showToast(`Switching account due to ${label} quota limit`, "warning", input.quietMode)
        } else {
          await input.showToast("Switching account due to 5h and weekly quota limits", "warning", input.quietMode)
        }
      }
    } catch (error) {
      input.quotaRefreshAtByIdentity.set(input.identityForQuota, now + QUOTA_REFRESH_FAILURE_RETRY_MS)
      input.log?.debug("quota refresh during request failed", {
        identityKey: input.identityForQuota,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  })()
}
