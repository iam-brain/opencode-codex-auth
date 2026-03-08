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

function readStdinText() {
  try {
    return readFileSync(0, "utf8")
  } catch {
    return ""
  }
}

function parseTouchedPaths(output) {
  return output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function parsePrePushUpdates(stdinText) {
  return stdinText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/)
      return { localRef, localSha, remoteRef, remoteSha }
    })
    .filter((update) => update.localRef && update.localSha && update.remoteRef && update.remoteSha)
}

function isAllZeroRef(value) {
  return typeof value === "string" && /^[0]+$/.test(value)
}

function resolvePrePushTouchedFiles(repoRoot, stdinText) {
  const updates = parsePrePushUpdates(stdinText)
  if (updates.length === 0) return []

  const touched = new Set()
  for (const update of updates) {
    if (isAllZeroRef(update.localSha)) continue

    const commits = !isAllZeroRef(update.remoteSha)
      ? runGit(["rev-list", `${update.remoteSha}..${update.localSha}`], { cwd: repoRoot })
      : runGit(["rev-list", update.localSha, "--not", "--remotes=origin"], { cwd: repoRoot })

    for (const commit of parseTouchedPaths(commits)) {
      const changed = runGit(["diff-tree", "--no-commit-id", "--name-only", "-r", "--diff-filter=ACMRTUXB", commit], {
        cwd: repoRoot
      })
      for (const filePath of parseTouchedPaths(changed)) {
        touched.add(filePath)
      }
    }
  }

  return Array.from(touched).sort((a, b) => a.localeCompare(b))
}

function resolveHookTarget(repoRoot, hookName, stdinText = "") {
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
    const touchedFingerprint = createHash("sha256")
      .update(resolvePrePushTouchedFiles(repoRoot, stdinText).join("\0"))
      .digest("hex")
    return `head:${headTree}:${touchedFingerprint}`
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
const stdinText = hookName === "pre-push" ? readStdinText() : ""
const fingerprint = resolveHookTarget(repoRoot, hookName, stdinText)
const stampPath = resolveGitPath(repoRoot, "opencode-codex-auth/verify-stamp.json")
const stamp = readStamp(stampPath)

if (stamp?.fingerprint === fingerprint) {
  console.log(`Skipping local verify for ${hookName}; current tree already passed npm run verify.`)
  process.exit(0)
}

console.log(`Running npm run verify for ${hookName}...`)

const verifyEnv = { ...process.env }
if (hookName === "pre-push") {
  const touchedFiles = resolvePrePushTouchedFiles(repoRoot, stdinText)
  if (touchedFiles.length > 0) {
    verifyEnv.COVERAGE_RATCHET_TOUCHED_FILES = touchedFiles.join("\n")
  }
}

const verifyResult = spawnSync("npm", ["run", "verify"], {
  cwd: repoRoot,
  env: verifyEnv,
  stdio: "inherit"
})

if (verifyResult.status !== 0) {
  process.exit(verifyResult.status ?? 1)
}

writeStamp(stampPath, {
  fingerprint: resolveHookTarget(repoRoot, hookName, stdinText),
  hookName,
  verifiedAt: new Date().toISOString()
})

console.log(`Local verify passed for ${hookName}.`)
