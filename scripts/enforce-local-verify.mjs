import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })

  if (result.status !== 0) {
    const stderr = result.stderr?.trim()
    throw new Error(stderr || `git ${args.join(" ")} failed with status ${result.status ?? "unknown"}`)
  }

  return result.stdout
}

function resolveRepoRoot() {
  return runGit(["rev-parse", "--show-toplevel"]).trim()
}

function resolveGitPath(repoRoot, relativePath) {
  return runGit(["rev-parse", "--git-path", relativePath], { cwd: repoRoot }).trim()
}

function listGitPaths(repoRoot, args) {
  return runGit(args, { cwd: repoRoot })
    .split("\0")
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
}

function summarizePaths(paths) {
  if (paths.length === 0) return ""
  const preview = paths.slice(0, 5).join(", ")
  const suffix = paths.length > 5 ? ` (+${paths.length - 5} more)` : ""
  return `${preview}${suffix}`
}

function resolveHookTarget(repoRoot, hookName) {
  const stagedPaths = listGitPaths(repoRoot, ["diff", "--cached", "--name-only", "-z"])
  const unstagedPaths = listGitPaths(repoRoot, ["diff", "--name-only", "-z"])
  const untrackedPaths = listGitPaths(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"])

  if (hookName === "pre-push") {
    const dirtyPaths = [...new Set([...stagedPaths, ...unstagedPaths, ...untrackedPaths])]
    if (dirtyPaths.length > 0) {
      throw new Error(
        `pre-push verify requires a clean working tree so it validates the pushed commits, not local WIP. Dirty paths: ${summarizePaths(dirtyPaths)}`
      )
    }

    const headTree = runGit(["rev-parse", "HEAD^{tree}"], { cwd: repoRoot }).trim()
    return `head:${headTree}`
  }

  if (unstagedPaths.length > 0 || untrackedPaths.length > 0) {
    const dirtyPaths = [...new Set([...unstagedPaths, ...untrackedPaths])]
    throw new Error(
      `pre-commit verify requires staged-only commit-ready changes with no extra local WIP. Dirty paths: ${summarizePaths(dirtyPaths)}`
    )
  }

  const indexTree = runGit(["write-tree"], { cwd: repoRoot }).trim()
  const stagedFingerprint =
    stagedPaths.length > 0 ? createHash("sha256").update(stagedPaths.join("\0")).digest("hex") : "clean"
  return `index:${indexTree}:${stagedFingerprint}`
}

function readStamp(stampPath) {
  if (!existsSync(stampPath)) return undefined

  try {
    return JSON.parse(readFileSync(stampPath, "utf8"))
  } catch {
    return undefined
  }
}

function writeStamp(stampPath, payload) {
  mkdirSync(path.dirname(stampPath), { recursive: true })
  writeFileSync(stampPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

const repoRoot = resolveRepoRoot()
const hookName = process.argv[2] ?? "manual"
const fingerprint = resolveHookTarget(repoRoot, hookName)
const stampPath = resolveGitPath(repoRoot, "opencode-codex-auth/verify-stamp.json")
const stamp = readStamp(stampPath)

if (stamp?.fingerprint === fingerprint) {
  console.log(`Skipping local verify for ${hookName}; current tree already passed npm run verify.`)
  process.exit(0)
}

console.log(`Running npm run verify for ${hookName}...`)

const verifyResult = spawnSync("npm", ["run", "verify"], {
  cwd: repoRoot,
  stdio: "inherit"
})

if (verifyResult.status !== 0) {
  process.exit(verifyResult.status ?? 1)
}

writeStamp(stampPath, {
  fingerprint: resolveHookTarget(repoRoot, hookName),
  hookName,
  verifiedAt: new Date().toISOString()
})

console.log(`Local verify passed for ${hookName}.`)
