import fs from "node:fs/promises"
import path from "node:path"

type LockFunction = (file: string, options?: Record<string, unknown>) => Promise<() => Promise<void>>

type RetryOptions = {
  retries: number
  minTimeout: number
  maxTimeout: number
}

let cachedLockFunction: LockFunction | undefined

function resolveLockFunction(value: unknown, visited = new Set<unknown>()): LockFunction | undefined {
  if (typeof value === "function") {
    return value as LockFunction
  }
  if (!value || typeof value !== "object") {
    return undefined
  }
  if (visited.has(value)) {
    return undefined
  }
  visited.add(value)

  const record = value as Record<string, unknown>
  const direct = resolveLockFunction(record.lock, visited)
  if (direct) return direct

  const viaDefault = resolveLockFunction(record.default, visited)
  if (viaDefault) return viaDefault

  const viaModule = resolveLockFunction(record.module, visited)
  if (viaModule) return viaModule

  const viaExports = resolveLockFunction(record.exports, visited)
  if (viaExports) return viaExports

  return undefined
}

function isFsErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}

function toRetryOptions(value: unknown): RetryOptions {
  const defaultOptions: RetryOptions = {
    retries: 0,
    minTimeout: 50,
    maxTimeout: 200
  }
  if (!value || typeof value !== "object") {
    return defaultOptions
  }

  const record = value as Record<string, unknown>
  const retries =
    typeof record.retries === "number" && Number.isFinite(record.retries)
      ? Math.max(0, Math.floor(record.retries))
      : defaultOptions.retries
  const minTimeout =
    typeof record.minTimeout === "number" && Number.isFinite(record.minTimeout)
      ? Math.max(1, Math.floor(record.minTimeout))
      : defaultOptions.minTimeout
  const maxTimeout =
    typeof record.maxTimeout === "number" && Number.isFinite(record.maxTimeout)
      ? Math.max(minTimeout, Math.floor(record.maxTimeout))
      : defaultOptions.maxTimeout

  return {
    retries,
    minTimeout,
    maxTimeout
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function lockWithDirectoryFallback(
  targetPath: string,
  options?: Record<string, unknown>
): Promise<() => Promise<void>> {
  const lockDir = `${targetPath}.lock`
  const retry = toRetryOptions(options?.retries)
  const staleMs = typeof options?.stale === "number" && Number.isFinite(options.stale) ? Math.max(1, options.stale) : 0

  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.mkdir(lockDir)
      return async () => {
        try {
          await fs.rm(lockDir, { recursive: true, force: true })
        } catch (error) {
          if (!isFsErrorCode(error, "ENOENT")) {
            throw error
          }
        }
      }
    } catch (error) {
      if (!isFsErrorCode(error, "EEXIST")) {
        throw error
      }

      if (staleMs > 0) {
        try {
          const stat = await fs.stat(lockDir)
          if (Date.now() - stat.mtimeMs > staleMs) {
            await fs.rm(lockDir, { recursive: true, force: true })
            continue
          }
        } catch (staleError) {
          if (!isFsErrorCode(staleError, "ENOENT")) {
            throw staleError
          }
          continue
        }
      }

      if (attempt >= retry.retries) {
        throw error
      }

      const timeout = Math.min(retry.maxTimeout, retry.minTimeout * 2 ** attempt)
      await sleep(timeout)
    }
  }
}

async function resolveImportedLockFunction(specifier: string): Promise<LockFunction | undefined> {
  try {
    return resolveLockFunction(await import(specifier))
  } catch {
    return undefined
  }
}

async function getLockFunction(): Promise<LockFunction> {
  if (cachedLockFunction) return cachedLockFunction

  cachedLockFunction =
    (await resolveImportedLockFunction("proper-lockfile")) ??
    (await resolveImportedLockFunction("proper-lockfile/index.js")) ??
    lockWithDirectoryFallback

  return cachedLockFunction
}

const LOCK_RETRIES = {
  retries: 20,
  minTimeout: 10,
  maxTimeout: 100
}

type LockTargetOptions = {
  staleMs?: number
}
const FILE_LOCK_SUFFIX = ".lock"

function resolveLockOptions(options: LockTargetOptions = {}): {
  realpath: true
  retries: typeof LOCK_RETRIES
  stale?: number
} {
  const staleMs = typeof options.staleMs === "number" && Number.isFinite(options.staleMs) ? options.staleMs : undefined
  return {
    realpath: true,
    retries: LOCK_RETRIES,
    ...(staleMs !== undefined ? { stale: Math.max(1, Math.floor(staleMs)) } : {})
  }
}

export function lockTargetPathForFile(filePath: string): string {
  return `${filePath}${FILE_LOCK_SUFFIX}`
}

async function ensureLockTargetFile(lockTargetPath: string): Promise<void> {
  const handle = await fs.open(lockTargetPath, "a", 0o600)
  await handle.close()
}

export async function withLockedDirectory<T>(
  directoryPath: string,
  fn: () => Promise<T>,
  options: LockTargetOptions = {}
): Promise<T> {
  await fs.mkdir(directoryPath, { recursive: true })
  const lock = await getLockFunction()
  const release = await lock(directoryPath, resolveLockOptions(options))
  try {
    return await fn()
  } finally {
    await release()
  }
}

export async function withLockedFile<T>(
  filePath: string,
  fn: () => Promise<T>,
  options: LockTargetOptions = {}
): Promise<T> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const lockTargetPath = lockTargetPathForFile(filePath)
  await ensureLockTargetFile(lockTargetPath)
  const lock = await getLockFunction()
  const release = await lock(lockTargetPath, resolveLockOptions(options))
  try {
    return await fn()
  } finally {
    await release()
  }
}
