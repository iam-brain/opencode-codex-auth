import lockfile from "proper-lockfile"

import fs from "node:fs/promises"
import path from "node:path"

import type { CodexRateLimitSnapshot } from "./types"

export type SnapshotMap = Record<string, CodexRateLimitSnapshot>
const PRIVATE_DIR_MODE = 0o700

async function ensurePrivateDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true, mode: PRIVATE_DIR_MODE })
  try {
    await fs.chmod(dirPath, PRIVATE_DIR_MODE)
  } catch {
    // best-effort permissions
  }
}

async function readJson(filePath: string): Promise<SnapshotMap> {
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
    return JSON.parse(raw) as SnapshotMap
  } catch {
    return {}
  }
}

async function writeAtomic(filePath: string, data: SnapshotMap) {
  await ensurePrivateDir(path.dirname(filePath))
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now().toString(36)}`
  const serialized = `${JSON.stringify(data, null, 2)}\n`
  await fs.writeFile(tmpPath, serialized, { mode: 0o600 })
  await fs.rename(tmpPath, filePath)
  try {
    await fs.chmod(filePath, 0o600)
  } catch {
    // best-effort permissions
  }
}

export async function loadSnapshots(filePath: string): Promise<SnapshotMap> {
  return readJson(filePath)
}

export async function saveSnapshots(
  filePath: string,
  update: (current: SnapshotMap) => SnapshotMap | Promise<SnapshotMap>
): Promise<SnapshotMap> {
  await ensurePrivateDir(path.dirname(filePath))

  const release = await lockfile.lock(filePath, {
    realpath: false,
    retries: {
      retries: 20,
      minTimeout: 10,
      maxTimeout: 100
    }
  })

  try {
    const cur = await loadSnapshots(filePath)
    const next = await update(cur)
    await writeAtomic(filePath, next)
    return next
  } finally {
    await release()
  }
}
