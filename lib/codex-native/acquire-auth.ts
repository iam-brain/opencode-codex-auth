import type { AccountSelectionTrace, AuthData, FetchOrchestratorAuthContext } from "../fetch-orchestrator"
import { PluginFatalError, formatWaitTime, isPluginFatalError } from "../fatal-errors"
import { ensureIdentityKey, normalizeEmail, normalizePlan } from "../identity"
import type { Logger } from "../logger"
import { createStickySessionState, selectAccount, type StickySessionState } from "../rotation"
import { ensureOpenAIOAuthDomain, saveAuthStorage } from "../storage"
import type { OpenAIAuthMode, RotationStrategy } from "../types"
import { parseJwtClaims } from "../claims"
import { formatAccountLabel } from "./accounts"
import { extractAccountId, refreshAccessToken, type OAuthTokenRefreshError } from "./oauth-utils"

const AUTH_REFRESH_FAILURE_COOLDOWN_MS = 30_000
const AUTH_REFRESH_LEASE_MS = 30_000

function isOAuthTokenRefreshError(value: unknown): value is OAuthTokenRefreshError {
  return value instanceof Error && ("status" in value || "oauthCode" in value)
}

type RefreshClaim = {
  identityKey: string
  refreshToken: string
}

export type AcquireOpenAIAuthInput = {
  authMode: OpenAIAuthMode
  context?: FetchOrchestratorAuthContext
  isSubagentRequest: boolean
  stickySessionState: StickySessionState
  hybridSessionState: StickySessionState
  seenSessionKeys: Map<string, number>
  persistSessionAffinityState: () => void
  pidOffsetEnabled: boolean
  configuredRotationStrategy?: RotationStrategy
  log?: Logger
}

export function createAcquireOpenAIAuthInputDefaults(): {
  stickySessionState: StickySessionState
  hybridSessionState: StickySessionState
} {
  return {
    stickySessionState: createStickySessionState(),
    hybridSessionState: createStickySessionState()
  }
}

export async function acquireOpenAIAuth(input: AcquireOpenAIAuthInput): Promise<AuthData> {
  let access: string | undefined
  let accountId: string | undefined
  let identityKey: string | undefined
  let accountLabel: string | undefined
  let email: string | undefined
  let plan: string | undefined
  const attempted = new Set<string>()
  let sawInvalidGrant = false
  let sawRefreshFailure = false
  let sawMissingRefresh = false
  let totalAccounts = 0
  let rotationLogged = false
  let lastSelectionTrace: AccountSelectionTrace | undefined

  try {
    if (input.isSubagentRequest && input.context?.sessionKey) {
      input.seenSessionKeys.delete(input.context.sessionKey)
      input.stickySessionState.bySessionKey.delete(input.context.sessionKey)
      input.hybridSessionState.bySessionKey.delete(input.context.sessionKey)
    }

    while (true) {
      let refreshClaim: RefreshClaim | undefined
      let shouldStop = false

      await saveAuthStorage(undefined, (authFile) => {
        const now = Date.now()
        const openai = authFile.openai
        if (!openai || openai.type !== "oauth") {
          throw new PluginFatalError({
            message: "Not authenticated with OpenAI. Run `opencode auth login`.",
            status: 401,
            type: "oauth_not_configured",
            param: "auth"
          })
        }

        const domain = ensureOpenAIOAuthDomain(authFile, input.authMode)
        totalAccounts = domain.accounts.length
        if (domain.accounts.length === 0) {
          throw new PluginFatalError({
            message: `No OpenAI ${input.authMode} accounts configured. Run \`opencode auth login\`.`,
            status: 401,
            type: "no_accounts_configured",
            param: "accounts"
          })
        }

        const enabled = domain.accounts.filter((account) => account.enabled !== false)
        if (enabled.length === 0) {
          throw new PluginFatalError({
            message: `No enabled OpenAI ${input.authMode} accounts available. Enable an account or run \`opencode auth login\`.`,
            status: 403,
            type: "no_enabled_accounts",
            param: "accounts"
          })
        }

        const rotationStrategy: RotationStrategy = input.configuredRotationStrategy ?? domain.strategy ?? "sticky"
        if (!rotationLogged) {
          input.log?.debug("rotation begin", {
            strategy: rotationStrategy,
            activeIdentityKey: domain.activeIdentityKey,
            totalAccounts: domain.accounts.length,
            enabledAccounts: enabled.length,
            mode: input.authMode,
            sessionKey: input.context?.sessionKey ?? null
          })
          rotationLogged = true
        }

        if (attempted.size >= domain.accounts.length) {
          shouldStop = true
          return
        }

        const sessionState =
          rotationStrategy === "sticky"
            ? input.stickySessionState
            : rotationStrategy === "hybrid"
              ? input.hybridSessionState
              : undefined

        const selected = selectAccount({
          accounts: domain.accounts,
          strategy: rotationStrategy,
          activeIdentityKey: domain.activeIdentityKey,
          now,
          stickyPidOffset: input.pidOffsetEnabled,
          stickySessionKey: input.isSubagentRequest ? undefined : input.context?.sessionKey,
          stickySessionState: sessionState,
          onDebug: (event) => {
            lastSelectionTrace = {
              strategy: event.strategy,
              decision: event.decision,
              totalCount: event.totalCount,
              disabledCount: event.disabledCount,
              cooldownCount: event.cooldownCount,
              refreshLeaseCount: event.refreshLeaseCount,
              eligibleCount: event.eligibleCount,
              attemptedCount: attempted.size + (event.selectedIdentityKey ? 1 : 0),
              ...(event.selectedIdentityKey ? { selectedIdentityKey: event.selectedIdentityKey } : null),
              ...(event.activeIdentityKey ? { activeIdentityKey: event.activeIdentityKey } : null),
              ...(event.sessionKey ? { sessionKey: event.sessionKey } : null)
            }
            input.log?.debug("rotation decision", event)
          }
        })

        if (!selected) {
          input.log?.debug("rotation stop: no selectable account", {
            attempted: attempted.size,
            totalAccounts: domain.accounts.length
          })
          shouldStop = true
          return
        }

        const selectedIndex = domain.accounts.findIndex((account) => account === selected)
        const attemptKey =
          selected.identityKey ??
          selected.refresh ??
          (selectedIndex >= 0 ? `idx:${selectedIndex}` : `idx:${attempted.size}`)

        if (attempted.has(attemptKey)) {
          input.log?.debug("rotation stop: duplicate attempt key", {
            attemptKey,
            selectedIdentityKey: selected.identityKey,
            selectedIndex
          })
          shouldStop = true
          return
        }

        attempted.add(attemptKey)
        if (!input.isSubagentRequest && input.context?.sessionKey && sessionState) {
          input.persistSessionAffinityState()
        }

        input.log?.debug("rotation candidate selected", {
          attemptKey,
          selectedIdentityKey: selected.identityKey,
          selectedIndex,
          selectedEnabled: selected.enabled !== false,
          selectedCooldownUntil: selected.cooldownUntil ?? null,
          selectedExpires: selected.expires ?? null
        })
        if (lastSelectionTrace) {
          lastSelectionTrace = {
            ...lastSelectionTrace,
            attemptedCount: attempted.size,
            ...(selected.identityKey ? { selectedIdentityKey: selected.identityKey } : null),
            ...(selectedIndex >= 0 ? { selectedIndex } : null),
            attemptKey
          }
        }

        accountLabel = formatAccountLabel(selected, selectedIndex >= 0 ? selectedIndex : 0)
        email = selected.email
        plan = selected.plan

        if (selected.access && selected.expires && selected.expires > now) {
          selected.lastUsed = now
          access = selected.access
          accountId = selected.accountId
          identityKey = selected.identityKey
          if (selected.identityKey) domain.activeIdentityKey = selected.identityKey
          return
        }

        if (!selected.refresh) {
          sawMissingRefresh = true
          selected.cooldownUntil = now + AUTH_REFRESH_FAILURE_COOLDOWN_MS
          return
        }

        if (!selected.identityKey) {
          sawRefreshFailure = true
          selected.cooldownUntil = now + AUTH_REFRESH_FAILURE_COOLDOWN_MS
          return
        }

        selected.refreshLeaseUntil = now + AUTH_REFRESH_LEASE_MS
        refreshClaim = {
          identityKey: selected.identityKey,
          refreshToken: selected.refresh
        }
      })

      if (access) break
      if (!refreshClaim) {
        if (shouldStop || (totalAccounts > 0 && attempted.size >= totalAccounts)) {
          break
        }
        continue
      }

      try {
        const tokens = await refreshAccessToken(refreshClaim.refreshToken)
        const refreshedExpires = Date.now() + (tokens.expires_in ?? 3600) * 1000
        const refreshedAccountId = extractAccountId(tokens)
        const claims = parseJwtClaims(tokens.id_token ?? tokens.access_token)

        await saveAuthStorage(undefined, (authFile) => {
          const domain = ensureOpenAIOAuthDomain(authFile, input.authMode)
          const selected = domain.accounts.find((account) => account.identityKey === refreshClaim?.identityKey)
          if (!selected) return

          if (selected.enabled === false) {
            delete selected.refreshLeaseUntil
            return
          }

          const now = Date.now()
          if (typeof selected.refreshLeaseUntil !== "number" || selected.refreshLeaseUntil <= now) {
            delete selected.refreshLeaseUntil
            return
          }

          selected.refresh = tokens.refresh_token
          selected.access = tokens.access_token
          selected.expires = refreshedExpires
          selected.accountId = refreshedAccountId || selected.accountId
          if (claims?.email) selected.email = normalizeEmail(claims.email)
          if (claims?.plan) selected.plan = normalizePlan(claims.plan)
          ensureIdentityKey(selected)
          selected.lastUsed = now
          delete selected.refreshLeaseUntil
          delete selected.cooldownUntil
          if (selected.identityKey) domain.activeIdentityKey = selected.identityKey

          accountLabel = formatAccountLabel(selected, 0)
          email = selected.email
          plan = selected.plan
          access = selected.access
          accountId = selected.accountId
          identityKey = selected.identityKey
        })
      } catch (error) {
        const invalidGrant = isOAuthTokenRefreshError(error) && error.oauthCode?.toLowerCase() === "invalid_grant"
        if (invalidGrant) {
          sawInvalidGrant = true
        } else {
          sawRefreshFailure = true
        }

        await saveAuthStorage(undefined, (authFile) => {
          const domain = ensureOpenAIOAuthDomain(authFile, input.authMode)
          const selected = domain.accounts.find((account) => account.identityKey === refreshClaim?.identityKey)
          if (!selected) return

          delete selected.refreshLeaseUntil
          if (invalidGrant) {
            selected.enabled = false
            delete selected.cooldownUntil
            return
          }

          if (selected.enabled === false) return
          selected.cooldownUntil = Date.now() + AUTH_REFRESH_FAILURE_COOLDOWN_MS
        })
      }

      if (access) break
      if (totalAccounts > 0 && attempted.size >= totalAccounts) {
        break
      }
    }

    if (!access) {
      await saveAuthStorage(undefined, (authFile) => {
        const now = Date.now()
        const openai = authFile.openai
        if (!openai || openai.type !== "oauth") {
          throw new PluginFatalError({
            message: "Not authenticated with OpenAI. Run `opencode auth login`.",
            status: 401,
            type: "oauth_not_configured",
            param: "auth"
          })
        }

        const domain = ensureOpenAIOAuthDomain(authFile, input.authMode)
        const enabledAfterAttempts = domain.accounts.filter((account) => account.enabled !== false)
        if (enabledAfterAttempts.length === 0 && sawInvalidGrant) {
          throw new PluginFatalError({
            message:
              "All enabled OpenAI refresh tokens were rejected (invalid_grant). Run `opencode auth login` to reauthenticate.",
            status: 401,
            type: "refresh_invalid_grant",
            param: "auth"
          })
        }

        const nextAvailableAt = enabledAfterAttempts.reduce<number | undefined>((current, account) => {
          const cooldownUntil =
            typeof account.refreshLeaseUntil === "number" && account.refreshLeaseUntil > now
              ? account.refreshLeaseUntil
              : account.cooldownUntil
          if (typeof cooldownUntil !== "number" || cooldownUntil <= now) return current
          if (current === undefined || cooldownUntil < current) return cooldownUntil
          return current
        }, undefined)

        if (nextAvailableAt !== undefined) {
          const waitMs = Math.max(0, nextAvailableAt - now)
          throw new PluginFatalError({
            message: `All enabled OpenAI accounts are cooling down. Try again in ${formatWaitTime(waitMs)} or run \`opencode auth login\`.`,
            status: 429,
            type: "all_accounts_cooling_down",
            param: "accounts"
          })
        }

        if (sawInvalidGrant) {
          throw new PluginFatalError({
            message:
              "OpenAI refresh token was rejected (invalid_grant). Run `opencode auth login` to reauthenticate this account.",
            status: 401,
            type: "refresh_invalid_grant",
            param: "auth"
          })
        }

        if (sawMissingRefresh) {
          throw new PluginFatalError({
            message: "Selected OpenAI account is missing a refresh token. Run `opencode auth login` to reauthenticate.",
            status: 401,
            type: "missing_refresh_token",
            param: "accounts"
          })
        }

        if (sawRefreshFailure) {
          throw new PluginFatalError({
            message: "Failed to refresh OpenAI access token. Run `opencode auth login` and try again.",
            status: 401,
            type: "refresh_failed",
            param: "auth"
          })
        }

        throw new PluginFatalError({
          message: `No enabled OpenAI ${input.authMode} accounts available. Enable an account or run \`opencode auth login\`.`,
          status: 403,
          type: "no_enabled_accounts",
          param: "accounts"
        })
      })
    }
  } catch (error) {
    if (isPluginFatalError(error)) throw error
    throw new PluginFatalError({
      message:
        "Unable to access OpenAI auth storage. Check plugin configuration and run `opencode auth login` if needed.",
      status: 500,
      type: "auth_storage_error",
      param: "auth"
    })
  }

  if (!access) {
    throw new PluginFatalError({
      message: "No valid OpenAI access token available. Run `opencode auth login`.",
      status: 401,
      type: "no_valid_access_token",
      param: "auth"
    })
  }

  return {
    access,
    accountId,
    identityKey,
    accountLabel,
    email,
    plan,
    ...(lastSelectionTrace ? { selectionTrace: lastSelectionTrace } : null)
  }
}
