import fs from "node:fs/promises"
import path from "node:path"

import { normalizeAccountAuthTypes } from "./account-auth-types.js"
import {
  buildIdentityKey,
  buildLegacyIdentityFingerprint,
  ensureIdentityKey,
  normalizeEmail,
  normalizePlan,
  synchronizeIdentityKey
} from "./identity.js"
import { extractAccountIdFromClaims, extractEmailFromClaims, extractPlanFromClaims, parseJwtClaims } from "./claims.js"
import { quarantineFile } from "./quarantine.js"
import {
  CODEX_ACCOUNTS_FILE,
  defaultAuthPath,
  opencodeProviderAuthLegacyFallbackPath,
  opencodeProviderAuthPath,
  legacyOpenAICodexAccountsPathFor
} from "./paths.js"
import { isRecord as isObject } from "./util.js"
import { ensureConfigDirGitignore } from "./config-dir-gitignore.js"
import { withLockedFile } from "./cache-lock.js"
import { isFsErrorCode, writeJsonFileAtomic } from "./cache-io.js"
import type { AccountRecord, AuthFile, OpenAIAuthMode, OpenAIOAuthDomain, OpenAIMultiOauthAuth } from "./types.js"

type LegacyOpenAIOauth = {
  type: "oauth"
  refresh: string
  access: string
  expires: number
  accountId?: string
  email?: string
  plan?: string
}

type LegacyCodexAccountsRecord = {
  refreshToken?: unknown
  accessToken?: unknown
  access?: unknown
  expires?: unknown
  expiresAt?: unknown
  accountId?: unknown
  email?: unknown
  plan?: unknown
  enabled?: unknown
  authTypes?: unknown
  lastUsed?: unknown
  coolingDownUntil?: unknown
  cooldownUntil?: unknown
}

type AuthLoadOptions = {
  quarantineDir?: string
  now?: () => number
  keep?: number
  lockReads?: boolean
}

const OPENAI_AUTH_MODES: OpenAIAuthMode[] = ["native", "codex"]

function listLegacyProviderAuthCandidates(env: Record<string, string | undefined> = process.env): string[] {
  const primary = opencodeProviderAuthPath(env)
  const legacyFallback = opencodeProviderAuthLegacyFallbackPath(env)
  if (primary === legacyFallback) return [primary]
  return [primary, legacyFallback]
}

function ensureAccountAuthTypes(account: AccountRecord): void {
  account.authTypes = normalizeAccountAuthTypes(account.authTypes)
}

function isOpenAIOAuthDomain(value: unknown): value is OpenAIOAuthDomain {
  if (!isObject(value)) return false
  return Array.isArray(value.accounts)
}

function normalizeAccountRecord(account: AccountRecord, authMode?: OpenAIAuthMode): void {
  const claims =
    typeof account.access === "string" && account.access.length > 0 ? parseJwtClaims(account.access) : undefined
  if (!account.accountId) account.accountId = extractAccountIdFromClaims(claims)
  if (!account.email) account.email = extractEmailFromClaims(claims)
  if (!account.plan) account.plan = extractPlanFromClaims(claims)
  account.email = normalizeEmail(account.email)
  account.plan = normalizePlan(account.plan)
  if (account.accountId) account.accountId = account.accountId.trim()
  synchronizeIdentityKey(account)
  if (authMode) {
    account.authTypes = [authMode]
  } else {
    ensureAccountAuthTypes(account)
  }
}

function ensureDomainAccountHealth(domain: OpenAIOAuthDomain, authMode: OpenAIAuthMode): void {
  for (const account of domain.accounts) {
    normalizeAccountRecord(account, authMode)
  }

  if (
    domain.activeIdentityKey &&
    !domain.accounts.some((account) => account.identityKey === domain.activeIdentityKey)
  ) {
    const fallback = domain.accounts.find((account) => account.identityKey)
    domain.activeIdentityKey = fallback?.identityKey
  }
}

function splitAccountsByAuthMode(accounts: AccountRecord[]): Record<OpenAIAuthMode, AccountRecord[]> {
  const out: Record<OpenAIAuthMode, AccountRecord[]> = { native: [], codex: [] }
  for (const account of accounts) {
    const normalizedTypes = normalizeAccountAuthTypes(account.authTypes)
    for (const authMode of normalizedTypes) {
      const cloned: AccountRecord = { ...account, authTypes: [authMode] }
      normalizeAccountRecord(cloned, authMode)
      out[authMode].push(cloned)
    }
  }
  return out
}

function isAccountEnabled(account: AccountRecord | undefined): boolean {
  return account?.enabled !== false
}

function mergeAccountRecordsByFreshness(
  existing: AccountRecord,
  incoming: AccountRecord,
  mergedTypes: AccountRecord["authTypes"],
  preferIncoming: boolean
): AccountRecord {
  const primary = preferIncoming ? incoming : existing
  const secondary = preferIncoming ? existing : incoming
  return {
    ...secondary,
    ...primary,
    authTypes: mergedTypes,
    enabled: isAccountEnabled(existing) || isAccountEnabled(incoming)
  }
}

function mergeDomainAccounts(native?: OpenAIOAuthDomain, codex?: OpenAIOAuthDomain): OpenAIOAuthDomain {
  const mergedByIdentity = new Map<string, AccountRecord>()
  const fallbackByFingerprint = new Map<string, AccountRecord>()

  const add = (authMode: OpenAIAuthMode, account: AccountRecord) => {
    const identity = account.identityKey
    if (!identity) {
      const fingerprint = buildLegacyIdentityFingerprint(account)
      const existingFallback = fallbackByFingerprint.get(fingerprint)
      if (!existingFallback) {
        fallbackByFingerprint.set(fingerprint, {
          ...account,
          authTypes: [authMode]
        })
        return
      }

      const mergedTypes = normalizeAccountAuthTypes([...(existingFallback.authTypes ?? []), authMode])
      const existingExpires = typeof existingFallback.expires === "number" ? existingFallback.expires : -Infinity
      const incomingExpires = typeof account.expires === "number" ? account.expires : -Infinity
      const preferIncoming = incomingExpires > existingExpires
      fallbackByFingerprint.set(fingerprint, {
        ...mergeAccountRecordsByFreshness(existingFallback, account, mergedTypes, preferIncoming)
      })
      return
    }

    const existing = mergedByIdentity.get(identity)
    if (!existing) {
      mergedByIdentity.set(identity, {
        ...account,
        authTypes: [authMode]
      })
      return
    }

    const mergedTypes = normalizeAccountAuthTypes([...(existing.authTypes ?? []), authMode])
    const existingExpires = typeof existing.expires === "number" ? existing.expires : -Infinity
    const incomingExpires = typeof account.expires === "number" ? account.expires : -Infinity
    const preferIncoming = incomingExpires > existingExpires

    mergedByIdentity.set(identity, mergeAccountRecordsByFreshness(existing, account, mergedTypes, preferIncoming))
  }

  for (const account of native?.accounts ?? []) add("native", account)
  for (const account of codex?.accounts ?? []) add("codex", account)

  const mergedAccounts = [...mergedByIdentity.values(), ...fallbackByFingerprint.values()]
  const fallbackIdentityCounts = new Map<string, number>()
  for (const account of mergedAccounts) {
    normalizeAccountRecord(account)
    if (account.identityKey) continue
    const fingerprint = buildLegacyIdentityFingerprint(account)
    const occurrence = fallbackIdentityCounts.get(fingerprint) ?? 0
    fallbackIdentityCounts.set(fingerprint, occurrence + 1)
    account.identityKey = occurrence > 0 ? `${fingerprint}|dup:${occurrence + 1}` : fingerprint
  }

  const hasEnabledIdentity = (identityKey: string | undefined): identityKey is string =>
    typeof identityKey === "string" &&
    mergedAccounts.some((account) => account.identityKey === identityKey && account.enabled !== false)

  const mergedActiveIdentityKey = hasEnabledIdentity(native?.activeIdentityKey)
    ? native?.activeIdentityKey
    : hasEnabledIdentity(codex?.activeIdentityKey)
      ? codex?.activeIdentityKey
      : mergedAccounts.find((account) => account.enabled !== false && account.identityKey)?.identityKey

  return {
    strategy: native?.strategy ?? codex?.strategy,
    accounts: mergedAccounts,
    activeIdentityKey: mergedActiveIdentityKey
  }
}

function normalizeOpenAIOAuthState(openai: OpenAIMultiOauthAuth): OpenAIMultiOauthAuth {
  const nativeDomain = isOpenAIOAuthDomain(openai.native)
    ? {
        strategy: openai.native.strategy,
        accounts: [...openai.native.accounts],
        activeIdentityKey: openai.native.activeIdentityKey
      }
    : undefined
  const codexDomain = isOpenAIOAuthDomain(openai.codex)
    ? {
        strategy: openai.codex.strategy,
        accounts: [...openai.codex.accounts],
        activeIdentityKey: openai.codex.activeIdentityKey
      }
    : undefined

  let normalizedNative = nativeDomain
  let normalizedCodex = codexDomain

  if (normalizedNative && normalizedNative.strategy === undefined && openai.strategy !== undefined) {
    normalizedNative.strategy = openai.strategy
  }
  if (normalizedCodex && normalizedCodex.strategy === undefined && openai.strategy !== undefined) {
    normalizedCodex.strategy = openai.strategy
  }

  if (!normalizedNative && !normalizedCodex) {
    const split = splitAccountsByAuthMode(openai.accounts ?? [])
    normalizedNative = {
      strategy: openai.strategy,
      accounts: split.native,
      activeIdentityKey: openai.activeIdentityKey
    }
    normalizedCodex =
      split.codex.length > 0
        ? {
            strategy: openai.strategy,
            accounts: split.codex,
            activeIdentityKey: openai.activeIdentityKey
          }
        : undefined
  }

  if (normalizedNative) ensureDomainAccountHealth(normalizedNative, "native")
  if (normalizedCodex) ensureDomainAccountHealth(normalizedCodex, "codex")

  const merged = mergeDomainAccounts(normalizedNative, normalizedCodex)
  return {
    type: "oauth",
    strategy: merged.strategy,
    accounts: merged.accounts,
    activeIdentityKey: merged.activeIdentityKey,
    ...(normalizedNative ? { native: normalizedNative } : {}),
    ...(normalizedCodex ? { codex: normalizedCodex } : {})
  }
}

function isMultiOauthAuth(value: unknown): value is OpenAIMultiOauthAuth {
  if (!isObject(value)) return false
  if (value.type !== "oauth") return false
  return (
    Array.isArray((value as { accounts?: unknown }).accounts) ||
    isOpenAIOAuthDomain((value as { native?: unknown }).native) ||
    isOpenAIOAuthDomain((value as { codex?: unknown }).codex)
  )
}

function isLegacyOauthAuth(value: unknown): value is LegacyOpenAIOauth {
  if (!isObject(value)) return false
  if (value.type !== "oauth") return false
  return typeof value.refresh === "string" && typeof value.access === "string" && typeof value.expires === "number"
}

function sanitizeAuthFile(input: AuthFile, options?: { openAIOnly?: boolean }): AuthFile {
  const openAIOnly = options?.openAIOnly !== false
  if (openAIOnly) {
    if (input.openai) {
      return { openai: input.openai }
    }
    return {}
  }

  if (input.openai) {
    return { ...(input as Record<string, unknown>), openai: input.openai } as AuthFile
  }
  return { ...(input as Record<string, unknown>) } as AuthFile
}

function shouldEnforceOpenAIOnlyStorage(filePath: string): boolean {
  return path.basename(filePath) === CODEX_ACCOUNTS_FILE
}

function hasUsableOpenAIOAuth(auth: AuthFile): boolean {
  const openai = auth.openai
  if (!openai || openai.type !== "oauth") return false
  if (isMultiOauthAuth(openai)) {
    const normalized = normalizeOpenAIOAuthState(openai)
    return OPENAI_AUTH_MODES.some((authMode) => {
      const domain = normalized[authMode]
      if (!domain) return false
      return domain.accounts.some((account) => typeof account.refresh === "string" && account.refresh.trim().length > 0)
    })
  }
  return isLegacyOauthAuth(openai) && openai.refresh.trim().length > 0
}

function migrateAuthFile(input: AuthFile): AuthFile {
  const auth: AuthFile = input ?? {}
  const openai = auth.openai
  if (!openai || openai.type !== "oauth") return auth
  if (isMultiOauthAuth(openai)) {
    auth.openai = normalizeOpenAIOAuthState(openai)
    return auth
  }
  if (!isLegacyOauthAuth(openai)) return auth
  const claims = parseJwtClaims(openai.access)

  const account: AccountRecord = ensureIdentityKey({
    access: openai.access,
    refresh: openai.refresh,
    expires: openai.expires,
    accountId: openai.accountId || extractAccountIdFromClaims(claims),
    email: openai.email || extractEmailFromClaims(claims),
    plan: openai.plan || extractPlanFromClaims(claims),
    authTypes: ["native"],
    enabled: true
  })

  const migrated: OpenAIMultiOauthAuth = {
    type: "oauth",
    accounts: [],
    native: {
      accounts: [account],
      activeIdentityKey: account.identityKey
    }
  }

  auth.openai = normalizeOpenAIOAuthState(migrated)
  return auth
}

function migrateLegacyCodexAccounts(input: Record<string, unknown>): AuthFile | undefined {
  if (isObject((input as { openai?: unknown }).openai)) return undefined
  const rawAccounts = Array.isArray(input.accounts) ? input.accounts : undefined
  if (!rawAccounts || rawAccounts.length === 0) return undefined

  const mappedAccounts: AccountRecord[] = []
  for (const raw of rawAccounts) {
    if (!isObject(raw)) continue
    const source = raw as LegacyCodexAccountsRecord
    const refreshToken = typeof source.refreshToken === "string" ? source.refreshToken.trim() : ""
    if (!refreshToken) continue

    const accessToken =
      typeof source.accessToken === "string"
        ? source.accessToken
        : typeof source.access === "string"
          ? source.access
          : undefined
    const claims = accessToken ? parseJwtClaims(accessToken) : undefined
    const account: AccountRecord = ensureIdentityKey({
      refresh: refreshToken,
      access: accessToken,
      expires:
        typeof source.expiresAt === "number"
          ? source.expiresAt
          : typeof source.expires === "number"
            ? source.expires
            : 0,
      accountId: typeof source.accountId === "string" ? source.accountId : extractAccountIdFromClaims(claims),
      email: typeof source.email === "string" ? source.email : extractEmailFromClaims(claims),
      plan: typeof source.plan === "string" ? source.plan : extractPlanFromClaims(claims),
      authTypes: normalizeAccountAuthTypes(source.authTypes),
      enabled: typeof source.enabled === "boolean" ? source.enabled : true
    })
    ensureAccountAuthTypes(account)

    if (typeof source.lastUsed === "number") {
      account.lastUsed = source.lastUsed
    }

    const cooldownUntil =
      typeof source.cooldownUntil === "number"
        ? source.cooldownUntil
        : typeof source.coolingDownUntil === "number"
          ? source.coolingDownUntil
          : undefined
    if (typeof cooldownUntil === "number") {
      account.cooldownUntil = cooldownUntil
    }

    mappedAccounts.push(account)
  }

  if (mappedAccounts.length === 0) return undefined

  const activeIndex = typeof input.activeIndex === "number" ? Math.floor(input.activeIndex) : 0
  const safeActiveIndex = activeIndex >= 0 && activeIndex < mappedAccounts.length ? activeIndex : 0
  const activeIdentityKey = mappedAccounts[safeActiveIndex]?.identityKey

  const auth: AuthFile = {
    openai: {
      type: "oauth",
      accounts: mappedAccounts,
      ...(activeIdentityKey ? { activeIdentityKey } : {})
    }
  }
  return migrateAuthFile(auth)
}

async function readAuthUnlocked(
  filePath: string,
  opts?: { quarantineDir: string; now: () => number; keep?: number }
): Promise<AuthFile> {
  const openAIOnly = shouldEnforceOpenAIOnlyStorage(filePath)
  let raw: string
  try {
    raw = await fs.readFile(filePath, "utf8")
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {}
    }
    throw error
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed)) {
      throw new Error("Auth storage root must be a JSON object")
    }
    const legacyMigrated = migrateLegacyCodexAccounts(parsed)
    if (legacyMigrated) return sanitizeAuthFile(legacyMigrated, { openAIOnly })
    return sanitizeAuthFile(migrateAuthFile(parsed as AuthFile), { openAIOnly })
  } catch (error: unknown) {
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
        // Best effort quarantine only.
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

  const legacyCandidates = [legacyOpenAICodexAccountsPathFor(filePath), ...listLegacyProviderAuthCandidates(process.env)]
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
      // check next source
    }
  }

  return false
}

function ensureMultiOauthState(auth: AuthFile): OpenAIMultiOauthAuth {
  const openai = auth.openai
  if (!openai || openai.type !== "oauth") {
    const created: OpenAIMultiOauthAuth = {
      type: "oauth",
      accounts: [],
      native: { accounts: [] }
    }
    auth.openai = normalizeOpenAIOAuthState(created)
    return auth.openai as OpenAIMultiOauthAuth
  }
  if (!isMultiOauthAuth(openai)) {
    const migrated = migrateAuthFile({ openai }).openai
    if (migrated && isMultiOauthAuth(migrated)) {
      auth.openai = normalizeOpenAIOAuthState(migrated)
      return auth.openai as OpenAIMultiOauthAuth
    }
    const created: OpenAIMultiOauthAuth = {
      type: "oauth",
      accounts: [],
      native: { accounts: [] }
    }
    auth.openai = normalizeOpenAIOAuthState(created)
    return auth.openai as OpenAIMultiOauthAuth
  }
  auth.openai = normalizeOpenAIOAuthState(openai)
  return auth.openai as OpenAIMultiOauthAuth
}

function upsertDomainAccount(domain: OpenAIOAuthDomain, input: AccountRecord, authMode: OpenAIAuthMode): boolean {
  const incoming: AccountRecord = { ...input, authTypes: [authMode] }
  normalizeAccountRecord(incoming, authMode)

  const incomingIdentity = incoming.identityKey
  const incomingStrictIdentity = buildIdentityKey(incoming)
  const incomingRefresh = typeof incoming.refresh === "string" ? incoming.refresh : ""
  let strictMatchIndex = -1
  let refreshFallbackMatchIndex = -1
  let refreshFallbackAmbiguous = false

  domain.accounts.forEach((existing, index) => {
    if (strictMatchIndex >= 0) return
    normalizeAccountRecord(existing, authMode)
    const existingStrictIdentity = buildIdentityKey(existing)
    if (incomingIdentity && existing.identityKey === incomingIdentity) {
      strictMatchIndex = index
      return
    }
    if (incomingStrictIdentity && existingStrictIdentity && incomingStrictIdentity === existingStrictIdentity) {
      strictMatchIndex = index
      return
    }
    if (incomingRefresh && existing.refresh === incomingRefresh && (!incomingStrictIdentity || !existingStrictIdentity)) {
      if (refreshFallbackMatchIndex >= 0 && refreshFallbackMatchIndex !== index) {
        refreshFallbackAmbiguous = true
      } else {
        refreshFallbackMatchIndex = index
      }
    }
  })
  const matchIndex =
    strictMatchIndex >= 0
      ? strictMatchIndex
      : !refreshFallbackAmbiguous && refreshFallbackMatchIndex >= 0
        ? refreshFallbackMatchIndex
        : -1

  if (matchIndex < 0) {
    domain.accounts.push(incoming)
    return true
  }

  const existing = domain.accounts[matchIndex]
  if (!existing) return false
  const existingExpires = typeof existing.expires === "number" ? existing.expires : -Infinity
  const incomingExpires = typeof incoming.expires === "number" ? incoming.expires : -Infinity
  const preferIncoming = incomingExpires >= existingExpires
  domain.accounts[matchIndex] = preferIncoming
    ? { ...existing, ...incoming, authTypes: [authMode] }
    : { ...incoming, ...existing, authTypes: [authMode] }
  normalizeAccountRecord(domain.accounts[matchIndex], authMode)
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
    const legacyCandidates = [legacyOpenAICodexAccountsPathFor(filePath), ...listLegacyProviderAuthCandidates(process.env)]

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

        const legacyOpenAI = legacyAuth.openai
        if (!legacyOpenAI || legacyOpenAI.type !== "oauth") continue
        const normalizedLegacy = normalizeOpenAIOAuthState(
          isMultiOauthAuth(legacyOpenAI)
            ? legacyOpenAI
            : (migrateAuthFile({ openai: legacyOpenAI }).openai as OpenAIMultiOauthAuth)
        )

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

    current.openai = normalizeOpenAIOAuthState(current.openai as OpenAIMultiOauthAuth)
    await writeAuthUnlocked(filePath, current)
    return { imported, sourcesUsed }
  })
}

export function getOpenAIOAuthDomain(auth: AuthFile, authMode: OpenAIAuthMode): OpenAIOAuthDomain | undefined {
  const openai = auth.openai
  if (!openai || openai.type !== "oauth" || !isMultiOauthAuth(openai)) return undefined
  const normalized = normalizeOpenAIOAuthState(openai)
  auth.openai = normalized
  return normalized[authMode]
}

export function ensureOpenAIOAuthDomain(auth: AuthFile, authMode: OpenAIAuthMode): OpenAIOAuthDomain {
  const openai = requireOpenAIMultiOauthAuth(auth)
  const normalized = normalizeOpenAIOAuthState(openai)
  auth.openai = normalized

  const existing = normalized[authMode]
  if (existing) return existing

  const created: OpenAIOAuthDomain = {
    strategy: normalized.strategy,
    accounts: []
  }
  if (authMode === "native") normalized.native = created
  else normalized.codex = created
  auth.openai = normalizeOpenAIOAuthState(normalized)
  return (auth.openai as OpenAIMultiOauthAuth)[authMode] as OpenAIOAuthDomain
}

export function listOpenAIOAuthDomains(auth: AuthFile): Array<{ mode: OpenAIAuthMode; domain: OpenAIOAuthDomain }> {
  const out: Array<{ mode: OpenAIAuthMode; domain: OpenAIOAuthDomain }> = []
  for (const mode of OPENAI_AUTH_MODES) {
    const domain = getOpenAIOAuthDomain(auth, mode)
    if (!domain) continue
    out.push({ mode, domain })
  }
  return out
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

export function requireOpenAIMultiOauthAuth(auth: AuthFile): OpenAIMultiOauthAuth {
  const openai = auth.openai
  if (!openai || openai.type !== "oauth") {
    throw new Error("OpenAI OAuth not configured")
  }

  if (isMultiOauthAuth(openai)) {
    const normalized = normalizeOpenAIOAuthState(openai)
    auth.openai = normalized
    return normalized
  }

  if (isLegacyOauthAuth(openai)) {
    const account: AccountRecord = ensureIdentityKey({
      access: openai.access,
      refresh: openai.refresh,
      expires: openai.expires,
      accountId: openai.accountId,
      email: openai.email,
      plan: openai.plan,
      authTypes: ["native"],
      enabled: true
    })

    const migrated: OpenAIMultiOauthAuth = {
      type: "oauth",
      accounts: [],
      native: {
        accounts: [account],
        activeIdentityKey: account.identityKey
      }
    }

    const normalized = normalizeOpenAIOAuthState(migrated)
    auth.openai = normalized
    return normalized
  }

  throw new Error("Invalid OpenAI OAuth config")
}
