import fs from "node:fs/promises"
import path from "node:path"
import type { Logger } from "./logger"

type OnIoFailure = (event: { operation: string; filePath: string; error: unknown }) => void

let cacheIoFailureObserver: OnIoFailure | undefined

export function setCacheIoFailureObserver(observer: OnIoFailure | undefined): void {
  cacheIoFailureObserver = observer
}

function notifyCacheIoFailure(operation: string, filePath: string, error: unknown): void {
  try {
    cacheIoFailureObserver?.({ operation, filePath, error })
  } catch (observerError) {
    if (observerError instanceof Error) {
      // best-effort failure observer
    }
  }
}

export function isFsErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}

function isUnsupportedSyncError(error: unknown): boolean {
  if (process.platform !== "win32") return false
  return (
    isFsErrorCode(error, "EPERM") ||
    isFsErrorCode(error, "EINVAL") ||
    isFsErrorCode(error, "ENOTSUP") ||
    isFsErrorCode(error, "ENOSYS")
  )
}

async function syncHandleBestEffort(handle: fs.FileHandle): Promise<void> {
  try {
    await handle.sync()
  } catch (error) {
    if (!isUnsupportedSyncError(error)) {
      throw error
    }
  }
}

async function syncDirectoryBestEffort(dirPath: string): Promise<void> {
  let dirHandle: fs.FileHandle
  try {
    dirHandle = await fs.open(dirPath, "r")
  } catch (error) {
    if (isUnsupportedSyncError(error)) return
    throw error
  }
  try {
    await syncHandleBestEffort(dirHandle)
  } finally {
    await dirHandle.close()
  }
}

export async function enforceOwnerOnlyPermissions(filePath: string): Promise<void> {
  try {
    await fs.chmod(filePath, 0o600)
  } catch (error) {
    if (!isFsErrorCode(error, "EACCES") && !isFsErrorCode(error, "EPERM")) {
      throw error
    }
  }
}

export async function readJsonFileBestEffort(filePath: string): Promise<unknown | undefined> {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    return JSON.parse(raw) as unknown
  } catch (error) {
    if (!isFsErrorCode(error, "ENOENT")) {
      notifyCacheIoFailure("readJsonFileBestEffort", filePath, error)
    }
    if (error instanceof SyntaxError || isFsErrorCode(error, "ENOENT")) {
      return undefined
    }
    return undefined
  }
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await enforceOwnerOnlyPermissions(filePath)
}

export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    const tempHandle = await fs.open(tempPath, "r")
    try {
      await syncHandleBestEffort(tempHandle)
    } finally {
      await tempHandle.close()
    }
    await fs.rename(tempPath, filePath)
    await syncDirectoryBestEffort(path.dirname(filePath))
  } catch (error) {
    await fs.unlink(tempPath).catch((unlinkError) => {
      if (!isFsErrorCode(unlinkError, "ENOENT")) {
        // best-effort temp cleanup only
      }
    })
    throw error
  }
  await enforceOwnerOnlyPermissions(filePath)
}

export async function writeJsonFileBestEffort(filePath: string, value: unknown): Promise<void> {
  try {
    await writeJsonFile(filePath, value)
  } catch (error) {
    notifyCacheIoFailure("writeJsonFileBestEffort", filePath, error)
    if (error instanceof Error) {
      // best-effort persistence
    }
  }
}

export async function writeJsonFileAtomicBestEffort(filePath: string, value: unknown): Promise<void> {
  try {
    await writeJsonFileAtomic(filePath, value)
  } catch (error) {
    notifyCacheIoFailure("writeJsonFileAtomicBestEffort", filePath, error)
    if (error instanceof Error) {
      // best-effort persistence
    }
  }
}

export async function writeJsonFileBestEffortLogged(
  filePath: string,
  value: unknown,
  options: { log?: Logger; context: string }
): Promise<void> {
  await writeJsonFile(filePath, value).catch((error) => {
    options.log?.warn(`${options.context} write failed`, {
      filePath,
      error: error instanceof Error ? error.message : String(error)
    })
  })
}

export async function writeJsonFileAtomicBestEffortLogged(
  filePath: string,
  value: unknown,
  options: { log?: Logger; context: string }
): Promise<void> {
  await writeJsonFileAtomic(filePath, value).catch((error) => {
    options.log?.warn(`${options.context} write failed`, {
      filePath,
      error: error instanceof Error ? error.message : String(error)
    })
  })
}
