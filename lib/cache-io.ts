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
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await fs.rename(tempPath, filePath)
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
