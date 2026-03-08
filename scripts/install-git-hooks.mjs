import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const gitDir = resolve(repoRoot, ".git")
const hooksDir = resolve(repoRoot, ".githooks")

if (!existsSync(gitDir)) {
  console.error("Not a git repository; skipping hook installation.")
  process.exit(1)
}

if (!existsSync(hooksDir)) {
  console.error(`Missing hooks directory: ${hooksDir}`)
  process.exit(1)
}

const result = spawnSync("git", ["config", "core.hooksPath", ".githooks"], {
  cwd: repoRoot,
  stdio: "inherit"
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

console.log("Installed local git hooks from .githooks/")
