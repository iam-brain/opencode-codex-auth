import fs from "node:fs/promises"
import path from "node:path"

import lockfile from "proper-lockfile"

import { ensureIdentityKey } from "./identity"
import { defaultAuthPath } from "./paths"
import type { AccountRecord, AuthFile, OpenAIMultiOauthAuth } from "./types"

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

type LegacyOpenAIOauth = {
  type: "oauth"
  refresh: string
  access: string
  expires: number
  accountId?: string
  email?: string
  plan?: string
}

function isMultiOauthAuth(value: unknown): value is OpenAIMultiOauthAuth {
  if (!isObject(value)) return false
  if (value.type !== "oauth") return false
  if (!("accounts" in value)) return false
  return Array.isArray(value.accounts)
}

function isLegacyOauthAuth(value: unknown): value is LegacyOpenAIOauth {
  if (!isObject(value)) return false
  if (value.type !== "oauth") return false
  return (
    typeof value.refresh === "string" &&
    typeof value.access === "string" &&
    typeof value.expires === "number"
  )
}

function migrateAuthFile(input: AuthFile): AuthFile {
  const auth: AuthFile = input ?? {}
  const openai = auth.openai
  if (!openai || openai.type !== "oauth") return auth
  if (isMultiOauthAuth(openai)) return auth
  if (!isLegacyOauthAuth(openai)) return auth

  const account: AccountRecord = ensureIdentityKey({
    access: openai.access,
    refresh: openai.refresh,
    expires: openai.expires,
    accountId: openai.accountId,
    email: openai.email,
    plan: openai.plan,
    enabled: true
  })

  const migrated: OpenAIMultiOauthAuth = {
    type: "oauth",
    accounts: [account],
    activeIdentityKey: account.identityKey
  }

  auth.openai = migrated
  return auth
}

async function readAuthUnlocked(filePath: string): Promise<AuthFile> {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed)) return {}
    return migrateAuthFile(parsed as AuthFile)
  } catch (error: any) {
    if (error?.code === "ENOENT") return {}
    throw error
  }
}

async function writeAuthUnlocked(filePath: string, auth: AuthFile): Promise<void> {
  const tmpPath = `${filePath}.tmp`
  const serialized = `${JSON.stringify(auth, null, 2)}\n`
  await fs.writeFile(tmpPath, serialized, { mode: 0o600 })
  await fs.rename(tmpPath, filePath)
  try {
    await fs.chmod(filePath, 0o600)
  } catch {
    // best-effort permissions
  }
}

async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const release = await lockfile.lock(filePath, {
    realpath: false,
    retries: {
      retries: 20,
      minTimeout: 10,
      maxTimeout: 100
    }
  })

  try {
    return await fn()
  } finally {
    await release()
  }
}

export async function loadAuthStorage(
  filePath: string = defaultAuthPath()
): Promise<AuthFile> {
  return withFileLock(filePath, async () => readAuthUnlocked(filePath))
}

export async function saveAuthStorage(
  filePath: string = defaultAuthPath(),
  update: (auth: AuthFile) => void | AuthFile | Promise<void | AuthFile>
): Promise<AuthFile> {
  return withFileLock(filePath, async () => {
    const current = await readAuthUnlocked(filePath)
    const result = await update(current)
    const nextBase = result === undefined ? current : result
    const next = migrateAuthFile(nextBase)
    await writeAuthUnlocked(filePath, next)
    return next
  })
}
