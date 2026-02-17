import fs from "node:fs/promises"
import path from "node:path"

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

  // rename preferred; fallback to copy+unlink
  try {
    await fs.rename(input.sourcePath, dest)
  } catch {
    await fs.copyFile(input.sourcePath, dest)
    await fs.unlink(input.sourcePath)
  }

  // best-effort permissions
  try {
    await fs.chmod(dest, 0o600)
  } catch {
    // ignore
  }

  // bounded retention
  try {
    const allFiles = await fs.readdir(input.quarantineDir)
    const files = allFiles.filter((f) => f.startsWith(base + "."))
    files.sort() // timestamp in name -> lexical works for Date.now() values

    const excess = files.length - keep
    for (let i = 0; i < excess; i++) {
      const fp = path.join(input.quarantineDir, files[i]!)
      await fs.unlink(fp).catch(() => {})
    }
  } catch {
    // ignore readdir errors
  }

  return { quarantinedPath: dest }
}
