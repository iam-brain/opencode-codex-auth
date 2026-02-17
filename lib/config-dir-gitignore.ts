import fs from "node:fs/promises"
import path from "node:path"

export const CONFIG_DIR_GITIGNORE_ENTRIES = [
  ".gitignore",
  "codex-accounts.json",
  "codex-accounts.json.*.tmp",
  "cache/codex-session-affinity.json",
  "cache/codex-snapshots.json",
  "logs/codex-plugin/"
] as const

export async function ensureConfigDirGitignore(configDir: string): Promise<void> {
  const gitignorePath = path.join(configDir, ".gitignore")

  try {
    let content = ""
    try {
      content = await fs.readFile(gitignorePath, "utf8")
    } catch (error: unknown) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        return
      }
    }

    const existing = new Set(
      content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    )
    const missingEntries = CONFIG_DIR_GITIGNORE_ENTRIES.filter((entry) => !existing.has(entry))
    if (missingEntries.length === 0) return

    if (!content) {
      await fs.writeFile(gitignorePath, `${missingEntries.join("\n")}\n`, "utf8")
      return
    }

    const suffix = content.endsWith("\n") ? "" : "\n"
    await fs.appendFile(gitignorePath, `${suffix}${missingEntries.join("\n")}\n`, "utf8")
  } catch {
    // best-effort hygiene only
  }
}
