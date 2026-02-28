import type { AccountSelectionTrace, AuthData, FetchOrchestratorAuthContext } from "../fetch-orchestrator.js"
import { PluginFatalError, formatWaitTime, isPluginFatalError } from "../fatal-errors.js"
import { ensureIdentityKey, normalizeEmail, normalizePlan } from "../identity.js"
import type { Logger } from "../logger.js"
import { createStickySessionState, selectAccount, type StickySessionState } from "../rotation.js"
import { ensureOpenAIOAuthDomain, loadAuthStorage, saveAuthStorage } from "../storage.js"
import type { AccountRecord, OpenAIAuthMode, RotationStrategy } from "../types.js"
import { parseJwtClaims } from "../claims.js"
import { formatAccountLabel } from "./accounts.js"
import { extractAccountId, refreshAccessToken, type OAuthTokenRefreshError } from "./oauth-utils.js"

const AUTH_REFRESH_FAILURE_COOLDOWN_MS = 30_000
const AUTH_REFRESH_LEASE_MS = 30_000
const LAST_USED_WRITE_INTERVAL_MS = 60_000

function isOAuthTokenRefreshError(value: unknown): value is OAuthTokenRefreshError {
  return value instanceof Error && ("status" in value || "oauthCode" in value)
}

const TERMINAL_REFRESH_ERROR_CODES = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "refresh_token_revoked",
  "token_revoked"
])

function isTerminalRefreshCredentialError(error: unknown): boolean {
  if (isOAuthTokenRefreshError(error)) {
    const oauthCode = typeof error.oauthCode === "string" ? error.oauthCode.trim().toLowerCase() : undefined
    if (oauthCode && TERMINAL_REFRESH_ERROR_CODES.has(oauthCode)) {
      return true
    }
  }

  if (error instanceof Error) {
    const message = error.message.trim().toLowerCase()
    if (message.includes("invalid_grant")) return true
    if (message.includes("refresh token") && (message.includes("invalid") || message.includes("expired"))) {
      return true
    }
    if (message.includes("refresh token") && message.includes("revoked")) {
      return true
    }
  }

  return false
}

type RefreshClaim = {
  identityKey?: string
  refreshToken: string
  leaseUntil: number
  selectedIndex: number
}

export type AcquireOpenAIAuthInput = {
  authMode: OpenAIAuthMode
  context?: FetchOrchestratorAuthContext
  isSubagentRequest: boolean
  stickySessionState: StickySessionState
  hybridSessionState: StickySessionState
  seenSessionKeys: Map<string, number>
  persistSessionAffinityState: () => void | Promise<void>
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

function buildAttemptKeyForCandidate(account: AccountRecord, index: number): string {
  const identityKey = account.identityKey?.trim()
  if (identityKey) return identityKey

  const accountId = account.accountId?.trim()
  const email = normalizeEmail(account.email)
  const plan = normalizePlan(account.plan)
  if (accountId && email && plan) {
    return `${accountId}|${email}|${plan}`
  }

  return `idx:${index}`
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
  let sawMissingIdentity = false
  let totalAccounts = 0
  let rotationLogged = false
  let lastSelectionTrace: AccountSelectionTrace | undefined

  try {
    while (true) {
      let refreshClaim: RefreshClaim | undefined
      let shouldStop = false
      let shouldPersistSessionAffinityState = false
      const now = Date.now()
      const authSnapshot = await loadAuthStorage(undefined, { lockReads: false })
      const openai = authSnapshot.openai
      if (!openai || openai.type !== "oauth") {
        throw new PluginFatalError({
          message: "Not authenticated with OpenAI. Run `opencode auth login`.",
          status: 401,
          type: "oauth_not_configured",
          param: "auth"
        })
      }

      const domain = ensureOpenAIOAuthDomain(authSnapshot, input.authMode)
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

      const selectableEntries = domain.accounts
        .map((account, index) => ({
          account,
          index,
          attemptKey: buildAttemptKeyForCandidate(account, index)
        }))
        .filter((entry) => !attempted.has(entry.attemptKey))

      if (selectableEntries.length === 0) {
        input.log?.debug("rotation stop: exhausted candidate set", {
          attempted: attempted.size,
          totalAccounts: domain.accounts.length
        })
        shouldStop = true
      } else {
        const sessionState =
          rotationStrategy === "sticky"
            ? input.stickySessionState
            : rotationStrategy === "hybrid"
              ? input.hybridSessionState
              : undefined

        const selected = selectAccount({
          accounts: selectableEntries.map((entry) => entry.account),
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
        } else {
          const selectedEntry = selectableEntries.find((entry) => entry.account === selected)
          if (!selectedEntry) {
            shouldStop = true
          } else {
            const { index: selectedIndex, attemptKey } = selectedEntry

            if (attempted.has(attemptKey)) {
              input.log?.debug("rotation skip: duplicate attempt key", {
                attemptKey,
                selectedIdentityKey: selected.identityKey,
                selectedIndex
              })
            } else {
              attempted.add(attemptKey)
              if (!input.isSubagentRequest && input.context?.sessionKey && sessionState) {
                shouldPersistSessionAffinityState = true
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
              const selectedIdentityKey = ensureIdentityKey(selected).identityKey

              if (!selectedIdentityKey) {
                sawMissingIdentity = true
              } else if (selected.access && selected.expires && selected.expires > now) {
                access = selected.access
                accountId = selected.accountId
                identityKey = selectedIdentityKey
                const selectionStrategy = lastSelectionTrace?.strategy ?? input.configuredRotationStrategy ?? domain.strategy
                if (selectionStrategy === "hybrid" || selectionStrategy === "round_robin") {
                  await saveAuthStorage(undefined, (authFile) => {
                    const currentDomain = ensureOpenAIOAuthDomain(authFile, input.authMode)
                    const currentByIdentity = selectedIdentityKey
                      ? currentDomain.accounts.find((account) => account.identityKey === selectedIdentityKey)
                      : undefined
                    const current = currentByIdentity ?? currentDomain.accounts[selectedIndex]
                    if (!current) return
                    const currentIndex = currentDomain.accounts.findIndex((account) => account === current)
                    const currentAttemptKey = buildAttemptKeyForCandidate(
                      current,
                      currentIndex >= 0 ? currentIndex : selectedIndex
                    )
                    if (currentAttemptKey !== attemptKey || current.enabled === false) {
                      return
                    }
                    if (!current.identityKey && selectedIdentityKey) {
                      current.identityKey = selectedIdentityKey
                    }
                    if (selectionStrategy === "round_robin" && current.identityKey) {
                      if (currentDomain.activeIdentityKey !== current.identityKey) {
                        currentDomain.activeIdentityKey = current.identityKey
                      }
                      return
                    }

                    const currentNow = Date.now()
                    const previousLastUsed = typeof current.lastUsed === "number" ? current.lastUsed : undefined
                    if (previousLastUsed === undefined || currentNow - previousLastUsed >= LAST_USED_WRITE_INTERVAL_MS) {
                      current.lastUsed = currentNow
                    }
                  })
                }
              } else if (!selected.refresh) {
                sawMissingRefresh = true
                await saveAuthStorage(undefined, (authFile) => {
                  const currentDomain = ensureOpenAIOAuthDomain(authFile, input.authMode)
                  const currentByIdentity = selectedIdentityKey
                    ? currentDomain.accounts.find((account) => account.identityKey === selectedIdentityKey)
                    : undefined
                  const current = currentByIdentity ?? currentDomain.accounts[selectedIndex]
                  if (!current) return
                  const currentIndex = currentDomain.accounts.findIndex((account) => account === current)
                  const currentAttemptKey = buildAttemptKeyForCandidate(
                    current,
                    currentIndex >= 0 ? currentIndex : selectedIndex
                  )
                  if (currentAttemptKey !== attemptKey || current.enabled === false || current.refresh) {
                    return
                  }
                  current.cooldownUntil = now + AUTH_REFRESH_FAILURE_COOLDOWN_MS
                })
              } else {
                const leaseUntil = now + AUTH_REFRESH_LEASE_MS
                await saveAuthStorage(undefined, (authFile) => {
                  const currentDomain = ensureOpenAIOAuthDomain(authFile, input.authMode)
                  const currentByIdentity = currentDomain.accounts.find((account) => account.identityKey === selectedIdentityKey)
                  const current = currentByIdentity ?? currentDomain.accounts[selectedIndex]
                  if (!current) return
                  const currentIndex = currentDomain.accounts.findIndex((account) => account === current)
                  const currentAttemptKey = buildAttemptKeyForCandidate(
                    current,
                    currentIndex >= 0 ? currentIndex : selectedIndex
                  )
                  if (currentAttemptKey !== attemptKey) return
                  if (
                    current.enabled === false ||
                    !current.refresh ||
                    current.refresh !== selected.refresh ||
                    (typeof current.refreshLeaseUntil === "number" && current.refreshLeaseUntil > now)
                  ) {
                    return
                  }

                  current.refreshLeaseUntil = leaseUntil
                  refreshClaim = {
                    identityKey: current.identityKey ?? selectedIdentityKey,
                    refreshToken: current.refresh,
                    leaseUntil,
                    selectedIndex: currentIndex >= 0 ? currentIndex : selectedIndex
                  }
                })
              }
            }
          }
        }
      }

      if (access) break
      if (shouldPersistSessionAffinityState) {
        await input.persistSessionAffinityState()
      }
      if (!refreshClaim) {
        if (shouldStop || (totalAccounts > 0 && attempted.size >= totalAccounts)) {
          break
        }
        continue
      }

      try {
        const activeRefreshClaim = refreshClaim
        const tokens = await refreshAccessToken(activeRefreshClaim.refreshToken)
        const refreshedExpires = Date.now() + (tokens.expires_in ?? 3600) * 1000
        const refreshedAccountId = extractAccountId(tokens)
        const claims = parseJwtClaims(tokens.id_token ?? tokens.access_token)

        await saveAuthStorage(undefined, (authFile) => {
          const domain = ensureOpenAIOAuthDomain(authFile, input.authMode)
          const selected = activeRefreshClaim.identityKey
            ? domain.accounts.find((account) => account.identityKey === activeRefreshClaim.identityKey)
            : domain.accounts[activeRefreshClaim.selectedIndex]
          if (!selected) return

          const now = Date.now()
          if (
            typeof selected.refreshLeaseUntil !== "number" ||
            selected.refreshLeaseUntil !== activeRefreshClaim.leaseUntil ||
            selected.refreshLeaseUntil <= now ||
            selected.refresh !== activeRefreshClaim.refreshToken
          ) {
            if (selected.refreshLeaseUntil === activeRefreshClaim.leaseUntil) {
              delete selected.refreshLeaseUntil
            }
            return
          }

          if (selected.enabled === false) {
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
          const previousLastUsed = typeof selected.lastUsed === "number" ? selected.lastUsed : undefined
          if (previousLastUsed === undefined || now - previousLastUsed >= LAST_USED_WRITE_INTERVAL_MS) {
            selected.lastUsed = now
          }
          delete selected.refreshLeaseUntil
          delete selected.cooldownUntil
          if (selected.identityKey) domain.activeIdentityKey = selected.identityKey

          accountLabel = formatAccountLabel(selected, activeRefreshClaim.selectedIndex)
          email = selected.email
          plan = selected.plan
          access = selected.access
          accountId = selected.accountId
          identityKey = selected.identityKey
        })
      } catch (error) {
        const invalidGrant = isTerminalRefreshCredentialError(error)
        if (invalidGrant) {
          sawInvalidGrant = true
        } else {
          sawRefreshFailure = true
        }

        const activeRefreshClaim = refreshClaim
        await saveAuthStorage(undefined, (authFile) => {
          const domain = ensureOpenAIOAuthDomain(authFile, input.authMode)
          const selected = activeRefreshClaim.identityKey
            ? domain.accounts.find((account) => account.identityKey === activeRefreshClaim.identityKey)
            : domain.accounts[activeRefreshClaim.selectedIndex]
          if (!selected) return

          if (
            selected.refreshLeaseUntil !== activeRefreshClaim.leaseUntil ||
            selected.refresh !== activeRefreshClaim.refreshToken
          ) {
            return
          }

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
      const now = Date.now()
      const authSnapshot = await loadAuthStorage(undefined, { lockReads: false })
      const openai = authSnapshot.openai
      if (!openai || openai.type !== "oauth") {
        throw new PluginFatalError({
          message: "Not authenticated with OpenAI. Run `opencode auth login`.",
          status: 401,
          type: "oauth_not_configured",
          param: "auth"
        })
      }

      const domain = ensureOpenAIOAuthDomain(authSnapshot, input.authMode)
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

      if (sawMissingIdentity) {
        throw new PluginFatalError({
          message:
            "Selected OpenAI account is missing identity metadata. Run `opencode auth login` to reauthenticate.",
          status: 401,
          type: "missing_account_identity",
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
