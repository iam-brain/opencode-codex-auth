import { extractEmailFromClaims, extractPlanFromClaims, parseJwtClaims } from "../claims.js"
import { toolOutputForStatus } from "../codex-status-tool.js"
import { buildIdentityKey, ensureIdentityKey } from "../identity.js"
import {
  ensureOpenAIOAuthDomain,
  getOpenAIOAuthDomain,
  importLegacyInstallData,
  loadAuthStorage,
  saveAuthStorage,
  shouldOfferLegacyTransfer
} from "../storage.js"
import type { OpenAIAuthMode } from "../types.js"
import { runAuthMenuOnce } from "../ui/auth-menu-runner.js"
import { shouldUseColor } from "../ui/tty/ansi.js"
import {
  buildAuthMenuAccounts,
  ensureAccountAuthTypes,
  findDomainAccountIndex,
  hydrateAccountIdentityFromAccessClaims,
  reconcileActiveIdentityKey
} from "./accounts.js"
import { extractAccountId, refreshAccessToken } from "./oauth-utils.js"

type RunInteractiveAuthMenuInput = {
  authMode: OpenAIAuthMode
  allowExit: boolean
  refreshQuotaSnapshotsForAuthMenu: () => Promise<void>
}

const AUTH_MENU_REFRESH_LEASE_MS = 30_000

export async function runInteractiveAuthMenu(input: RunInteractiveAuthMenuInput): Promise<"add" | "exit"> {
  while (true) {
    const auth = await loadAuthStorage()
    const nativeDomain = getOpenAIOAuthDomain(auth, "native")
    const codexDomain = getOpenAIOAuthDomain(auth, "codex")
    const menuAccounts = buildAuthMenuAccounts({
      native: nativeDomain,
      codex: codexDomain,
      activeMode: input.authMode
    })
    const allowTransfer = await shouldOfferLegacyTransfer()

    const result = await runAuthMenuOnce({
      accounts: menuAccounts,
      allowTransfer,
      input: process.stdin,
      output: process.stdout,
      handlers: {
        onCheckQuotas: async () => {
          await input.refreshQuotaSnapshotsForAuthMenu()
          const report = await toolOutputForStatus(undefined, undefined, {
            style: "menu",
            useColor: shouldUseColor()
          })
          process.stdout.write(`\n${report}\n\n`)
        },
        onConfigureModels: async () => {
          process.stdout.write(
            "\nConfigure provider models in opencode.json and runtime flags in codex-config.json.\n\n"
          )
        },
        onTransfer: async () => {
          const transfer = await importLegacyInstallData()
          let hydrated = 0
          let refreshed = 0
          const refreshClaims: Array<{
            mode: OpenAIAuthMode
            accountIndex: number
            identityKey?: string
            refreshToken: string
            leaseUntil: number
          }> = []

          await saveAuthStorage(undefined, (authFile) => {
            for (const mode of ["native", "codex"] as const) {
              const domain = getOpenAIOAuthDomain(authFile, mode)
              if (!domain) continue

              for (let index = 0; index < domain.accounts.length; index += 1) {
                const account = domain.accounts[index]
                if (!account) continue
                const hadIdentity = Boolean(buildIdentityKey(account))
                hydrateAccountIdentityFromAccessClaims(account)
                const hasIdentityAfterClaims = Boolean(buildIdentityKey(account))
                if (!hadIdentity && hasIdentityAfterClaims) hydrated += 1

                if (account.enabled === false || !account.refresh) {
                  continue
                }
                const now = Date.now()
                if (typeof account.refreshLeaseUntil === "number" && account.refreshLeaseUntil > now) {
                  continue
                }
                if (account.expires && account.expires > now) {
                  delete account.refreshLeaseUntil
                  continue
                }
                const leaseUntil = now + AUTH_MENU_REFRESH_LEASE_MS
                account.refreshLeaseUntil = leaseUntil
                refreshClaims.push({
                  mode,
                  accountIndex: index,
                  identityKey: account.identityKey,
                  refreshToken: account.refresh,
                  leaseUntil
                })
              }
            }
            return authFile
          })

          for (const claim of refreshClaims) {
            try {
              const tokens = await refreshAccessToken(claim.refreshToken)
              await saveAuthStorage(undefined, (authFile) => {
                const domain = getOpenAIOAuthDomain(authFile, claim.mode)
                if (!domain) return authFile
                const account = domain.accounts[claim.accountIndex]
                if (!account) return authFile
                if (
                  account.refreshLeaseUntil !== claim.leaseUntil ||
                  account.refresh !== claim.refreshToken ||
                  (claim.identityKey && account.identityKey !== claim.identityKey)
                ) {
                  return authFile
                }

                const now = Date.now()
                if (
                  account.enabled === false ||
                  typeof account.refreshLeaseUntil !== "number" ||
                  account.refreshLeaseUntil !== claim.leaseUntil ||
                  account.refreshLeaseUntil <= now
                ) {
                  delete account.refreshLeaseUntil
                  return authFile
                }

                const hadIdentity = Boolean(buildIdentityKey(account))
                const claims = parseJwtClaims(tokens.id_token ?? tokens.access_token)
                account.refresh = tokens.refresh_token
                account.access = tokens.access_token
                account.expires = now + (tokens.expires_in ?? 3600) * 1000
                account.accountId = extractAccountId(tokens) || account.accountId
                account.email = extractEmailFromClaims(claims) || account.email
                account.plan = extractPlanFromClaims(claims) || account.plan
                account.lastUsed = now
                hydrateAccountIdentityFromAccessClaims(account)
                if (!hadIdentity && buildIdentityKey(account)) hydrated += 1
                refreshed += 1
                delete account.refreshLeaseUntil
                delete account.cooldownUntil
                return authFile
              })
            } catch (error) {
              await saveAuthStorage(undefined, (authFile) => {
                const domain = getOpenAIOAuthDomain(authFile, claim.mode)
                if (!domain) return authFile
                const account = domain.accounts[claim.accountIndex]
                if (!account) return authFile
                if (
                  account.refreshLeaseUntil !== claim.leaseUntil ||
                  account.refresh !== claim.refreshToken ||
                  (claim.identityKey && account.identityKey !== claim.identityKey)
                ) {
                  return authFile
                }
                if (account.refreshLeaseUntil === claim.leaseUntil) {
                  delete account.refreshLeaseUntil
                  if (account.enabled !== false) {
                    account.cooldownUntil = Date.now() + AUTH_MENU_REFRESH_LEASE_MS
                  }
                }
                return authFile
              })
              if (error instanceof Error) {
                // best effort per-account hydration
              }
            }
          }

          process.stdout.write(
            `\nTransfer complete: imported ${transfer.imported} account(s). Hydrated ${hydrated} account(s)` +
              `${refreshed > 0 ? `, refreshed ${refreshed} token(s)` : ""}.\n\n`
          )
        },
        onDeleteAll: async (scope) => {
          await saveAuthStorage(undefined, (authFile) => {
            const targets = scope === "both" ? (["native", "codex"] as const) : ([scope] as const)
            for (const targetMode of targets) {
              const domain = ensureOpenAIOAuthDomain(authFile, targetMode)
              domain.accounts = []
              domain.activeIdentityKey = undefined
            }
            return authFile
          })
          const deletedLabel =
            scope === "both"
              ? "Deleted all OpenAI accounts."
              : `Deleted ${scope === "native" ? "Native" : "Codex"} auth from all accounts.`
          process.stdout.write(`\n${deletedLabel}\n\n`)
        },
        onToggleAccount: async (account) => {
          await saveAuthStorage(undefined, (authFile) => {
            const authTypes: OpenAIAuthMode[] =
              account.authTypes && account.authTypes.length > 0 ? [...account.authTypes] : ["native"]
            for (const mode of authTypes) {
              const domain = getOpenAIOAuthDomain(authFile, mode)
              if (!domain) continue
              const idx = findDomainAccountIndex(domain, account)
              if (idx < 0) continue
              const target = domain.accounts[idx]
              if (!target) continue
              target.enabled = target.enabled === false
              reconcileActiveIdentityKey(domain)
            }
            return authFile
          })
          process.stdout.write("\nAccount status updated.\n\n")
        },
        onRefreshAccount: async (account) => {
          let refreshed = false
          const preferred = [
            input.authMode,
            ...((account.authTypes ?? []).filter((mode) => mode !== input.authMode) as OpenAIAuthMode[])
          ]

          for (const mode of preferred) {
            let claim:
              | {
                  mode: OpenAIAuthMode
                  identityKey: string
                  refreshToken: string
                  leaseUntil: number
                }
              | undefined

            await saveAuthStorage(undefined, (authFile) => {
              const domain = getOpenAIOAuthDomain(authFile, mode)
              if (!domain) return authFile
              const idx = findDomainAccountIndex(domain, account)
              if (idx < 0) return authFile
              const target = domain.accounts[idx]
              if (!target || target.enabled === false || !target.refresh || !target.identityKey) return authFile

              const now = Date.now()
              if (typeof target.refreshLeaseUntil === "number" && target.refreshLeaseUntil > now) return authFile

              const leaseUntil = now + AUTH_MENU_REFRESH_LEASE_MS
              target.refreshLeaseUntil = leaseUntil
              claim = {
                mode,
                identityKey: target.identityKey,
                refreshToken: target.refresh,
                leaseUntil
              }
              return authFile
            })

            if (!claim) continue
            const claimed = claim

            try {
              const tokens = await refreshAccessToken(claimed.refreshToken)
              await saveAuthStorage(undefined, (authFile) => {
                const domain = getOpenAIOAuthDomain(authFile, claimed.mode)
                if (!domain) return authFile
                const target = domain.accounts.find((entry) => entry.identityKey === claimed.identityKey)
                if (!target) return authFile

                const now = Date.now()
                if (
                  target.enabled === false ||
                  typeof target.refreshLeaseUntil !== "number" ||
                  target.refreshLeaseUntil !== claimed.leaseUntil ||
                  target.refreshLeaseUntil <= now ||
                  target.refresh !== claimed.refreshToken
                ) {
                  if (target.refreshLeaseUntil === claimed.leaseUntil) {
                    delete target.refreshLeaseUntil
                  }
                  return authFile
                }

                const claims = parseJwtClaims(tokens.id_token ?? tokens.access_token)
                target.refresh = tokens.refresh_token
                target.access = tokens.access_token
                target.expires = now + (tokens.expires_in ?? 3600) * 1000
                target.accountId = extractAccountId(tokens) || target.accountId
                target.email = extractEmailFromClaims(claims) || target.email
                target.plan = extractPlanFromClaims(claims) || target.plan
                target.lastUsed = now
                ensureAccountAuthTypes(target)
                ensureIdentityKey(target)
                if (target.identityKey) domain.activeIdentityKey = target.identityKey
                delete target.refreshLeaseUntil
                delete target.cooldownUntil
                refreshed = true
                return authFile
              })
            } catch (error) {
              await saveAuthStorage(undefined, (authFile) => {
                const domain = getOpenAIOAuthDomain(authFile, claimed.mode)
                if (!domain) return authFile
                const target = domain.accounts.find((entry) => entry.identityKey === claimed.identityKey)
                if (!target) return authFile
                if (target.refreshLeaseUntil === claimed.leaseUntil && target.refresh === claimed.refreshToken) {
                  delete target.refreshLeaseUntil
                  if (target.enabled !== false) {
                    target.cooldownUntil = Date.now() + AUTH_MENU_REFRESH_LEASE_MS
                  }
                } else if (target.refreshLeaseUntil === claimed.leaseUntil) {
                  delete target.refreshLeaseUntil
                }
                return authFile
              })
              if (error instanceof Error) {
                // keep UI response simple; surface generic failure text below
              }
            }

            if (refreshed) break
          }
          process.stdout.write(
            refreshed
              ? "\nAccount refreshed successfully.\n\n"
              : "\nAccount refresh failed. Run `opencode auth login` to reauthenticate.\n\n"
          )
        },
        onDeleteAccount: async (account, scope) => {
          await saveAuthStorage(undefined, (authFile) => {
            const targets = scope === "both" ? (["native", "codex"] as const) : ([scope] as const)
            for (const mode of targets) {
              const domain = getOpenAIOAuthDomain(authFile, mode)
              if (!domain) continue
              const idx = findDomainAccountIndex(domain, account)
              if (idx < 0) continue
              domain.accounts.splice(idx, 1)
              reconcileActiveIdentityKey(domain)
            }
            return authFile
          })
          const deletedLabel =
            scope === "both"
              ? "Deleted account."
              : `Deleted ${scope === "native" ? "Native" : "Codex"} auth from account.`
          process.stdout.write(`\n${deletedLabel}\n\n`)
        }
      }
    })

    if (result === "add") return "add"
    if (result === "exit") {
      if (input.allowExit) return "exit"
      continue
    }
  }
}
