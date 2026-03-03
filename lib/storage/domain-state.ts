import { normalizeAccountAuthTypes } from "../account-auth-types.js"
import {
  buildLegacyIdentityFingerprint,
  ensureIdentityKey,
  normalizeEmail,
  normalizePlan,
  synchronizeIdentityKey
} from "../identity.js"
import { extractAccountIdFromClaims, extractEmailFromClaims, extractPlanFromClaims, parseJwtClaims } from "../claims.js"
import { isRecord as isObject } from "../util.js"
import type { AccountRecord, AuthFile, OpenAIAuthMode, OpenAIOAuthDomain, OpenAIMultiOauthAuth } from "../types.js"

export type LegacyOpenAIOauth = {
  type: "oauth"
  refresh: string
  access: string
  expires: number
  accountId?: string
  email?: string
  plan?: string
}

export const OPENAI_AUTH_MODES: OpenAIAuthMode[] = ["native", "codex"]

function ensureAccountAuthTypes(account: AccountRecord): void {
  account.authTypes = normalizeAccountAuthTypes(account.authTypes)
}

function isOpenAIOAuthDomain(value: unknown): value is OpenAIOAuthDomain {
  if (!isObject(value)) return false
  return Array.isArray(value.accounts)
}

export function normalizeAccountRecord(account: AccountRecord, authMode?: OpenAIAuthMode): void {
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

export function normalizeOpenAIOAuthState(openai: OpenAIMultiOauthAuth): OpenAIMultiOauthAuth {
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

export function isMultiOauthAuth(value: unknown): value is OpenAIMultiOauthAuth {
  if (!isObject(value)) return false
  if (value.type !== "oauth") return false
  return (
    Array.isArray((value as { accounts?: unknown }).accounts) ||
    isOpenAIOAuthDomain((value as { native?: unknown }).native) ||
    isOpenAIOAuthDomain((value as { codex?: unknown }).codex)
  )
}

export function isLegacyOauthAuth(value: unknown): value is LegacyOpenAIOauth {
  if (!isObject(value)) return false
  if (value.type !== "oauth") return false
  return typeof value.refresh === "string" && typeof value.access === "string" && typeof value.expires === "number"
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
  return auth.openai[authMode] as OpenAIOAuthDomain
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
