import fs from "node:fs/promises"
import path from "node:path"
import { enforceOwnerOnlyPermissions, isFsErrorCode } from "./cache-io"

export async function quarantineFile(input: {
  sourcePath: string
  quarantineDir: string
  now: () => number
  keep?: number
}): Promise<{ quarantinedPath: string }> {
  const keep = typeof input.keep === "number" && Number.isFinite(input.keep) ? Math.max(1, Math.floor(input.keep)) : 5
  await fs.mkdir(input.quarantineDir, { recursive: true })

  const base = path.basename(input.sourcePath)
  const dest = path.join(input.quarantineDir, `${base}.${input.now()}.quarantine.json`)

  const extractTimestamp = (fileName: string): number => {
    const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const match = fileName.match(new RegExp(`^${escapedBase}\\.(\\d+)\\.quarantine\\.json$`))
    if (!match?.[1]) return Number.NEGATIVE_INFINITY
    const parsed = Number.parseInt(match[1], 10)
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
  }

  // rename preferred; fallback to copy+unlink
  try {
    await fs.rename(input.sourcePath, dest)
  } catch (error) {
    if (!isFsErrorCode(error, "EXDEV")) {
      // fallback to copy+unlink for cross-device and similar rename failures
    }
    await fs.copyFile(input.sourcePath, dest)
    await fs.unlink(input.sourcePath)
  }

  // best-effort permissions
  try {
    await enforceOwnerOnlyPermissions(dest)
  } catch (error) {
    if (!isFsErrorCode(error, "EACCES") && !isFsErrorCode(error, "EPERM")) {
      // ignore
    }
    // ignore
  }

  // bounded retention
  try {
    const allFiles = await fs.readdir(input.quarantineDir)
    const files = allFiles.filter((f) => f.startsWith(base + "."))
    files.sort((left, right) => {
      const leftTs = extractTimestamp(left)
      const rightTs = extractTimestamp(right)
      if (leftTs !== rightTs) return leftTs - rightTs
      return left.localeCompare(right)
    })

    const excess = files.length - keep
    for (let i = 0; i < excess; i++) {
      const fp = path.join(input.quarantineDir, files[i]!)
      try {
        await fs.unlink(fp)
      } catch (error) {
        if (!isFsErrorCode(error, "ENOENT")) {
          // best-effort retention pruning
        }
      }
    }
  } catch (error) {
    if (!isFsErrorCode(error, "ENOENT")) {
      // ignore readdir errors
    }
    // ignore readdir errors
  }

  return { quarantinedPath: dest }
}
