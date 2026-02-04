import fs from "node:fs/promises"
import path from "node:path"

import lockfile from "proper-lockfile"

import { ensureIdentityKey } from "./identity"
import { defaultAuthPath } from "./paths"
import type { AccountRecord, AuthFile, OpenAIMultiOauthAuth } from "./types"

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function migrateAuthFile(input: AuthFile): AuthFile {
  const auth: AuthFile = input ?? {}
  const openai = auth.openai as any
  if (!openai || openai.type !== "oauth") return auth

  if (Array.isArray(openai.accounts)) {
    return auth
  }

  if (
    typeof openai.refresh !== "string" ||
    typeof openai.access !== "string" ||
    typeof openai.expires !== "number"
  ) {
    return auth
  }

  const account: AccountRecord = ensureIdentityKey({
    access: openai.access,
    refresh: openai.refresh,
    expires: openai.expires,
    accountId: typeof openai.accountId === "string" ? openai.accountId : undefined,
    email: typeof openai.email === "string" ? openai.email : undefined,
    plan: typeof openai.plan === "string" ? openai.plan : undefined,
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
    const next = migrateAuthFile((result ?? current) as AuthFile)
    await writeAuthUnlocked(filePath, next)
    return next
  })
}
