import type { CodexRateLimitSnapshot } from "./types.js"
import { withLockedFile } from "./cache-lock.js"
import { readJsonFileBestEffort, writeJsonFileAtomicBestEffort } from "./cache-io.js"

export type SnapshotMap = Record<string, CodexRateLimitSnapshot>

async function readJson(filePath: string): Promise<SnapshotMap> {
  const parsed = await readJsonFileBestEffort(filePath)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
  return parsed as SnapshotMap
}

async function writeAtomic(filePath: string, data: SnapshotMap) {
  await writeJsonFileAtomicBestEffort(filePath, data)
}

export async function loadSnapshots(filePath: string): Promise<SnapshotMap> {
  return readJson(filePath)
}

export async function saveSnapshots(
  filePath: string,
  update: (current: SnapshotMap) => SnapshotMap | Promise<SnapshotMap>
): Promise<SnapshotMap> {
  return withLockedFile(filePath, async () => {
    const cur = await loadSnapshots(filePath)
    const next = await update(cur)
    if (JSON.stringify(next) === JSON.stringify(cur)) {
      return next
    }
    await writeAtomic(filePath, next)
    return next
  })
}
