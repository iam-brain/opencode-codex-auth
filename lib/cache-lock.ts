import fs from "node:fs/promises"
import path from "node:path"
import lockfile from "proper-lockfile"

const LOCK_RETRIES = {
  retries: 20,
  minTimeout: 10,
  maxTimeout: 100
}

type LockTargetOptions = {
  staleMs?: number
}

function resolveLockOptions(options: LockTargetOptions = {}): {
  realpath: false
  retries: typeof LOCK_RETRIES
  stale?: number
} {
  const staleMs = typeof options.staleMs === "number" && Number.isFinite(options.staleMs) ? options.staleMs : undefined
  return {
    realpath: false,
    retries: LOCK_RETRIES,
    ...(staleMs !== undefined ? { stale: Math.max(1, Math.floor(staleMs)) } : {})
  }
}

export async function withLockedDirectory<T>(
  directoryPath: string,
  fn: () => Promise<T>,
  options: LockTargetOptions = {}
): Promise<T> {
  await fs.mkdir(directoryPath, { recursive: true })
  const release = await lockfile.lock(directoryPath, resolveLockOptions(options))
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
  const release = await lockfile.lock(filePath, resolveLockOptions(options))
  try {
    return await fn()
  } finally {
    await release()
  }
}
