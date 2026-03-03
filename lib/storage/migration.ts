import path from "node:path"

import { normalizeAccountAuthTypes } from "../account-auth-types.js"
import { buildIdentityKey, ensureIdentityKey } from "../identity.js"
import { extractAccountIdFromClaims, extractEmailFromClaims, extractPlanFromClaims, parseJwtClaims } from "../claims.js"
import {
  CODEX_ACCOUNTS_FILE,
  legacyOpenAICodexAccountsPathFor,
  opencodeProviderAuthLegacyFallbackPath,
  opencodeProviderAuthPath
} from "../paths.js"
import type { AccountRecord, AuthFile, OpenAIAuthMode, OpenAIOAuthDomain, OpenAIMultiOauthAuth } from "../types.js"
import {
  isLegacyOauthAuth,
  isMultiOauthAuth,
  normalizeAccountRecord,
  normalizeOpenAIOAuthState,
  OPENAI_AUTH_MODES
} from "./domain-state.js"

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

export function listLegacyProviderAuthCandidates(env: Record<string, string | undefined> = process.env): string[] {
  const primary = opencodeProviderAuthPath(env)
  const legacyFallback = opencodeProviderAuthLegacyFallbackPath(env)
  if (primary === legacyFallback) return [primary]
  return [primary, legacyFallback]
}

export function listLegacyAuthCandidates(filePath: string): string[] {
  return [legacyOpenAICodexAccountsPathFor(filePath), ...listLegacyProviderAuthCandidates(process.env)]
}

export function sanitizeAuthFile(input: AuthFile, options?: { openAIOnly?: boolean }): AuthFile {
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

export function shouldEnforceOpenAIOnlyStorage(filePath: string): boolean {
  return path.basename(filePath) === CODEX_ACCOUNTS_FILE
}

export function hasUsableOpenAIOAuth(auth: AuthFile): boolean {
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

export function migrateAuthFile(input: AuthFile): AuthFile {
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

export function migrateLegacyCodexAccounts(input: Record<string, unknown>): AuthFile | undefined {
  if (typeof input.openai === "object" && input.openai !== null && !Array.isArray(input.openai)) return undefined
  const rawAccounts = Array.isArray(input.accounts) ? input.accounts : undefined
  if (!rawAccounts || rawAccounts.length === 0) return undefined

  const mappedAccounts: AccountRecord[] = []
  for (const raw of rawAccounts) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue
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
    account.authTypes = normalizeAccountAuthTypes(account.authTypes)

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

export function ensureMultiOauthState(auth: AuthFile): OpenAIMultiOauthAuth {
  const openai = auth.openai
  if (!openai || openai.type !== "oauth") {
    const created: OpenAIMultiOauthAuth = {
      type: "oauth",
      accounts: [],
      native: { accounts: [] }
    }
    auth.openai = normalizeOpenAIOAuthState(created)
    return auth.openai
  }
  if (!isMultiOauthAuth(openai)) {
    const migrated = migrateAuthFile({ openai }).openai
    if (migrated && isMultiOauthAuth(migrated)) {
      auth.openai = normalizeOpenAIOAuthState(migrated)
      return auth.openai
    }
    const created: OpenAIMultiOauthAuth = {
      type: "oauth",
      accounts: [],
      native: { accounts: [] }
    }
    auth.openai = normalizeOpenAIOAuthState(created)
    return auth.openai
  }
  auth.openai = normalizeOpenAIOAuthState(openai)
  return auth.openai
}

export function upsertDomainAccount(
  domain: OpenAIOAuthDomain,
  input: AccountRecord,
  authMode: OpenAIAuthMode
): boolean {
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
    if (
      incomingRefresh &&
      existing.refresh === incomingRefresh &&
      (!incomingStrictIdentity || !existingStrictIdentity)
    ) {
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
