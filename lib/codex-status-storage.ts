import lockfile from "proper-lockfile"

import fs from "node:fs/promises"
import path from "node:path"

import type { CodexRateLimitSnapshot } from "./types"

export type SnapshotMap = Record<string, CodexRateLimitSnapshot>

async function readJson(filePath: string): Promise<SnapshotMap> {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    return JSON.parse(raw) as SnapshotMap
  } catch (error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {}
    }
    throw error
  }
}

async function writeAtomic(filePath: string, data: SnapshotMap) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.tmp`
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
  await fs.mkdir(path.dirname(filePath), { recursive: true })

  // Ensure file exists for lockfile
  try {
    await fs.access(filePath)
  } catch {
    await fs.writeFile(filePath, "{}", { mode: 0o600 })
  }

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
