import fs from "node:fs/promises"
import path from "node:path"

import { quarantineFile } from "./quarantine.js"
import { CODEX_ACCOUNTS_FILE, defaultAuthPath } from "./paths.js"
import { ensureConfigDirGitignore } from "./config-dir-gitignore.js"
import { withLockedFile } from "./cache-lock.js"
import { isFsErrorCode, writeJsonFileAtomic } from "./cache-io.js"
import type { AuthFile, OpenAIAuthMode } from "./types.js"
import { ensureOpenAIOAuthDomain, normalizeOpenAIOAuthState, OPENAI_AUTH_MODES } from "./storage/domain-state.js"
import {
  ensureMultiOauthState,
  hasUsableOpenAIOAuth,
  listLegacyAuthCandidates,
  migrateAuthFile,
  migrateLegacyCodexAccounts,
  sanitizeAuthFile,
  shouldEnforceOpenAIOnlyStorage,
  upsertDomainAccount
} from "./storage/migration.js"

type AuthLoadOptions = {
  quarantineDir?: string
  now?: () => number
  keep?: number
  lockReads?: boolean
}

async function readAuthUnlocked(
  filePath: string,
  opts?: { quarantineDir: string; now: () => number; keep?: number }
): Promise<AuthFile> {
  const openAIOnly = shouldEnforceOpenAIOnlyStorage(filePath)
  let raw: string
  try {
    raw = await fs.readFile(filePath, "utf8")
  } catch (_error: unknown) {
    if (_error && typeof _error === "object" && "code" in _error && _error.code === "ENOENT") {
      return {}
    }
    throw _error
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Auth storage root must be a JSON object")
    }
    const legacyMigrated = migrateLegacyCodexAccounts(parsed as Record<string, unknown>)
    if (legacyMigrated) return sanitizeAuthFile(legacyMigrated, { openAIOnly })
    return sanitizeAuthFile(migrateAuthFile(parsed as AuthFile), { openAIOnly })
  } catch (_error: unknown) {
    let quarantinedPath: string | undefined
    if (opts?.quarantineDir && opts.now) {
      try {
        const quarantined = await quarantineFile({
          sourcePath: filePath,
          quarantineDir: opts.quarantineDir,
          now: opts.now,
          keep: opts.keep
        })
        quarantinedPath = quarantined.quarantinedPath
        console.warn(
          `[opencode-codex-auth] Corrupt auth storage at ${filePath} was quarantined to ${opts.quarantineDir}.`
        )
      } catch (error) {
        if (!isFsErrorCode(error, "ENOENT")) {
          // Best effort quarantine only.
        }
      }
    }
    const detail = quarantinedPath ? ` Quarantined file: ${quarantinedPath}.` : ""
    throw new Error(`Corrupt auth storage JSON at ${filePath}.${detail} Re-authenticate or repair the file.`)
  }
}

export async function shouldOfferLegacyTransfer(filePath: string = defaultAuthPath()): Promise<boolean> {
  try {
    await fs.access(filePath)
    return false
  } catch (error) {
    if (!isFsErrorCode(error, "ENOENT")) {
      throw error
    }
    // codex-accounts.json missing; check legacy/native sources
  }

  const legacyCandidates = listLegacyAuthCandidates(filePath)
  for (const legacyPath of legacyCandidates) {
    try {
      await fs.access(legacyPath)
      const legacyAuth = await readAuthUnlocked(legacyPath)
      if (hasUsableOpenAIOAuth(legacyAuth)) {
        return true
      }
    } catch (error) {
      if (!isFsErrorCode(error, "ENOENT")) {
        // ignore unreadable/bad legacy sources and continue checking others
      }
    }
  }

  return false
}

export type LegacyTransferResult = {
  imported: number
  sourcesUsed: number
}

export async function importLegacyInstallData(filePath: string = defaultAuthPath()): Promise<LegacyTransferResult> {
  return withFileLock(filePath, async () => {
    const current = sanitizeAuthFile(migrateAuthFile(await readAuthUnlocked(filePath)), {
      openAIOnly: shouldEnforceOpenAIOnlyStorage(filePath)
    })
    const nextOpenAI = ensureMultiOauthState(current)
    current.openai = nextOpenAI

    let imported = 0
    let sourcesUsed = 0
    const legacyCandidates = listLegacyAuthCandidates(filePath)

    for (const legacyPath of legacyCandidates) {
      if (legacyPath === filePath) continue
      try {
        await fs.access(legacyPath)
      } catch (error) {
        if (!isFsErrorCode(error, "ENOENT")) {
          // Missing legacy source is expected; continue.
        }
        continue
      }

      try {
        const legacyAuth = await readAuthUnlocked(legacyPath)
        if (!hasUsableOpenAIOAuth(legacyAuth)) continue
        sourcesUsed += 1

        const normalizedLegacy = ensureMultiOauthState(legacyAuth)

        for (const mode of OPENAI_AUTH_MODES) {
          const sourceDomain = normalizedLegacy[mode]
          if (!sourceDomain) continue
          const targetDomain = ensureOpenAIOAuthDomain(current, mode)
          if (targetDomain.strategy === undefined && sourceDomain.strategy !== undefined) {
            targetDomain.strategy = sourceDomain.strategy
          }
          for (const account of sourceDomain.accounts) {
            if (upsertDomainAccount(targetDomain, account, mode)) {
              imported += 1
            }
          }
          if (
            sourceDomain.activeIdentityKey &&
            targetDomain.accounts.some((account) => account.identityKey === sourceDomain.activeIdentityKey)
          ) {
            targetDomain.activeIdentityKey = sourceDomain.activeIdentityKey
          }
        }
      } catch (error) {
        if (error instanceof Error) {
          // ignore unreadable/corrupt legacy source and continue
        }
      }
    }

    current.openai = normalizeOpenAIOAuthState(current.openai)
    await writeAuthUnlocked(filePath, current)
    return { imported, sourcesUsed }
  })
}

async function writeAuthUnlocked(filePath: string, auth: AuthFile): Promise<void> {
  await writeJsonFileAtomic(filePath, auth)
}

async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const dirPath = path.dirname(filePath)
  await fs.mkdir(dirPath, { recursive: true })
  if (path.basename(filePath) === CODEX_ACCOUNTS_FILE) {
    await ensureConfigDirGitignore(dirPath)
  }
  return withLockedFile(filePath, fn)
}

export async function loadAuthStorage(filePath: string = defaultAuthPath(), opts?: AuthLoadOptions): Promise<AuthFile> {
  const normalizedOpts = {
    quarantineDir: opts?.quarantineDir ?? path.join(path.dirname(filePath), "quarantine"),
    now: opts?.now ?? Date.now,
    keep: opts?.keep
  }
  if (opts?.lockReads === false) {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    if (path.basename(filePath) === CODEX_ACCOUNTS_FILE) {
      await ensureConfigDirGitignore(path.dirname(filePath))
    }
    return readAuthUnlocked(filePath, normalizedOpts)
  }
  return withFileLock(filePath, async () => readAuthUnlocked(filePath, normalizedOpts))
}

export async function saveAuthStorage(
  filePath: string = defaultAuthPath(),
  update: (auth: AuthFile) => void | AuthFile | Promise<void | AuthFile>
): Promise<AuthFile> {
  return withFileLock(filePath, async () => {
    const current = await readAuthUnlocked(filePath, {
      quarantineDir: path.join(path.dirname(filePath), "quarantine"),
      now: Date.now
    })
    const before = JSON.stringify(current)
    const result = await update(current)
    const nextBase = result === undefined ? current : result
    const next = sanitizeAuthFile(migrateAuthFile(nextBase), {
      openAIOnly: shouldEnforceOpenAIOnlyStorage(filePath)
    })
    if (JSON.stringify(next) === before) {
      return next
    }
    await writeAuthUnlocked(filePath, next)
    return next
  })
}

export async function setAccountCooldown(
  filePath: string = defaultAuthPath(),
  identityKey: string,
  cooldownUntil: number,
  authMode: OpenAIAuthMode = "native"
): Promise<AuthFile> {
  return saveAuthStorage(filePath, (auth) => {
    const domain = ensureOpenAIOAuthDomain(auth, authMode)
    const acc = domain.accounts.find((a) => a.identityKey === identityKey)
    if (acc && acc.enabled !== false) {
      acc.cooldownUntil = cooldownUntil
    }
  })
}

export async function updateAccountTokensByIdentityKey(
  filePath: string = defaultAuthPath(),
  identityKey: string,
  input: { access: string; refresh: string; expires: number },
  authMode: OpenAIAuthMode = "native"
): Promise<AuthFile> {
  return saveAuthStorage(filePath, (auth) => {
    const domain = ensureOpenAIOAuthDomain(auth, authMode)
    const acc = domain.accounts.find((a) => a.identityKey === identityKey)
    if (acc && acc.enabled !== false) {
      acc.access = input.access
      acc.refresh = input.refresh
      acc.expires = input.expires
    }
  })
}

export {
  ensureOpenAIOAuthDomain,
  getOpenAIOAuthDomain,
  listOpenAIOAuthDomains,
  requireOpenAIMultiOauthAuth
} from "./storage/domain-state.js"
