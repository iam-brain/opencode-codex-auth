import { extractEmailFromClaims, extractPlanFromClaims, parseJwtClaims } from "../claims"
import { toolOutputForStatus } from "../codex-status-tool"
import { buildIdentityKey, ensureIdentityKey } from "../identity"
import {
  ensureOpenAIOAuthDomain,
  getOpenAIOAuthDomain,
  importLegacyInstallData,
  loadAuthStorage,
  saveAuthStorage,
  shouldOfferLegacyTransfer
} from "../storage"
import type { OpenAIAuthMode } from "../types"
import { runAuthMenuOnce } from "../ui/auth-menu-runner"
import { shouldUseColor } from "../ui/tty/ansi"
import {
  buildAuthMenuAccounts,
  ensureAccountAuthTypes,
  findDomainAccountIndex,
  hydrateAccountIdentityFromAccessClaims,
  reconcileActiveIdentityKey
} from "./accounts"
import { extractAccountId, refreshAccessToken } from "./oauth-utils"

type RunInteractiveAuthMenuInput = {
  authMode: OpenAIAuthMode
  allowExit: boolean
  refreshQuotaSnapshotsForAuthMenu: () => Promise<void>
}

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
          await saveAuthStorage(undefined, async (authFile) => {
            for (const mode of ["native", "codex"] as const) {
              const domain = getOpenAIOAuthDomain(authFile, mode)
              if (!domain) continue

              for (const account of domain.accounts) {
                const hadIdentity = Boolean(buildIdentityKey(account))
                hydrateAccountIdentityFromAccessClaims(account)
                const hasIdentityAfterClaims = Boolean(buildIdentityKey(account))
                if (!hadIdentity && hasIdentityAfterClaims) hydrated += 1

                if (hasIdentityAfterClaims || account.enabled === false || !account.refresh) {
                  continue
                }

                try {
                  const tokens = await refreshAccessToken(account.refresh)
                  refreshed += 1
                  const now = Date.now()
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
                } catch (error) {
                  if (error instanceof Error) {
                    // best effort per-account hydration
                  }
                  // best effort per-account hydration
                }
              }
            }
            return authFile
          })
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
          process.stdout.write("\nUpdated account status.\n\n")
        },
        onRefreshAccount: async (account) => {
          let refreshed = false
          try {
            await saveAuthStorage(undefined, async (authFile) => {
              const preferred = [
                input.authMode,
                ...((account.authTypes ?? []).filter((mode) => mode !== input.authMode) as OpenAIAuthMode[])
              ]
              for (const mode of preferred) {
                const domain = getOpenAIOAuthDomain(authFile, mode)
                if (!domain) continue
                const idx = findDomainAccountIndex(domain, account)
                if (idx < 0) continue
                const target = domain.accounts[idx]
                if (!target || target.enabled === false || !target.refresh) continue
                const tokens = await refreshAccessToken(target.refresh)
                const now = Date.now()
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
                refreshed = true
                break
              }
              return authFile
            })
          } catch (error) {
            if (error instanceof Error) {
              // keep UI response simple; surface generic failure text below
            }
            refreshed = false
          }
          process.stdout.write(
            refreshed
              ? "\nAccount refreshed successfully.\n\n"
              : "\nAccount refresh failed. Run login to reauthenticate.\n\n"
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
