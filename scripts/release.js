#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

const VALID_BUMPS = new Set(["patch", "minor", "major"])
const bump = process.argv[2] ?? "patch"
const REQUIRED_CI_WORKFLOW = "ci.yml"
const RELEASE_WORKFLOW = "release.yml"
const REQUIRED_CI_JOBS = [
  "Verify on Node.js 20.x",
  "Verify on Node.js 22.x",
  "Package Smoke Test",
  "Package Smoke Test (Windows)",
  "Windows Runtime Hardening (Node.js 20.x)",
  "Windows Runtime Hardening (Node.js 22.x)",
  "Security Audit"
]
const REMOTE_CI_BYPASS_ENV = "RELEASE_SKIP_REMOTE_CI_GATE"
const DEFAULT_BRANCH_FALLBACK = "main"
const releaseAttemptState = {
  defaultBranch: "",
  tag: "",
  releaseHead: "",
  pushed: false
}

class ReleaseWorkflowFailureError extends Error {
  constructor(tag, conclusion, url) {
    super(`Release workflow failed for ${tag}: ${conclusion ?? "unknown"} ${url ?? ""}`.trim())
    this.name = "ReleaseWorkflowFailureError"
  }
}

if (!VALID_BUMPS.has(bump)) {
  console.error(`Invalid release bump "${bump}". Use one of: patch, minor, major.`)
  process.exit(1)
}

function run(command, args, opts = {}) {
  const capture = opts.capture === true
  const resolvedCommand = process.platform === "win32" && (command === "npm" || command === "npx") ? `${command}.cmd` : command
  const result = spawnSync(resolvedCommand, args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
  })

  if (result.error) {
    if (opts.allowFailure === true) {
      return {
        ...result,
        status: result.status ?? 1
      }
    }
    throw result.error
  }

  const status = result.status ?? 1
  if (status !== 0 && opts.allowFailure !== true) {
    if (capture && result.stderr) {
      process.stderr.write(result.stderr)
    }
    throw new Error(`Command failed (${status}): ${resolvedCommand} ${args.join(" ")}`)
  }

  return result
}

function runCapture(command, args) {
  return run(command, args, { capture: true }).stdout?.trim() ?? ""
}

function runCaptureAllowFailure(command, args) {
  const result = run(command, args, { capture: true, allowFailure: true })
  return {
    status: result.status ?? 1,
    stdout: result.stdout?.trim() ?? ""
  }
}

function parseJson(input, context) {
  try {
    return JSON.parse(input)
  } catch {
    throw new Error(`Failed to parse JSON for ${context}.`)
  }
}

function sleep(ms) {
  const shared = new SharedArrayBuffer(4)
  const view = new Int32Array(shared)
  Atomics.wait(view, 0, 0, ms)
}

function normalizeRepoSlug(raw) {
  const trimmed = String(raw ?? "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
  const parts = trimmed.split("/").filter(Boolean)
  if (parts.length !== 2) return undefined
  return `${parts[0]}/${parts[1]}`
}

function parseRepoSlug(remoteUrl) {
  const trimmed = remoteUrl.trim()
  if (!trimmed) return undefined

  const ssh = trimmed.match(/^git@github\.com:(.+?)(?:\.git)?$/)
  if (ssh?.[1]) return normalizeRepoSlug(ssh[1])

  const sshProto = trimmed.match(/^ssh:\/\/git@github\.com(?:[:/]\d+)?\/(.+?)(?:\.git)?\/?$/)
  if (sshProto?.[1]) return normalizeRepoSlug(sshProto[1])

  const https = trimmed.match(/^(?:git\+)?https:\/\/github\.com\/(.+?)(?:\.git)?\/?$/)
  if (https?.[1]) return normalizeRepoSlug(https[1])

  const gitProto = trimmed.match(/^git:\/\/github\.com\/(.+?)(?:\.git)?\/?$/)
  if (gitProto?.[1]) return normalizeRepoSlug(gitProto[1])

  try {
    const normalizedUrl = trimmed.startsWith("git+") ? trimmed.slice(4) : trimmed
    const parsed = new URL(normalizedUrl)
    if (parsed.hostname.trim().toLowerCase() !== "github.com") return undefined
    return normalizeRepoSlug(parsed.pathname)
  } catch {
    // Fall through.
  }

  return undefined
}

function hasGhCli() {
  const result = run("gh", ["--version"], { capture: true, allowFailure: true })
  return (result.status ?? 1) === 0
}

function hasGhAuth() {
  const result = run("gh", ["auth", "status"], { capture: true, allowFailure: true })
  return (result.status ?? 1) === 0
}

function shouldSkipRemoteCiGate() {
  return process.env[REMOTE_CI_BYPASS_ENV] === "1"
}

function resolveDefaultBranch() {
  const symbolic = runCaptureAllowFailure("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
  if (symbolic.status === 0 && symbolic.stdout.startsWith("origin/")) {
    const fromSymbolic = symbolic.stdout.slice("origin/".length).trim()
    if (fromSymbolic) return fromSymbolic
  }

  const symref = runCaptureAllowFailure("git", ["ls-remote", "--symref", "origin", "HEAD"])
  if (symref.status === 0 && symref.stdout) {
    const line = symref.stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith("ref:"))
    const match = line?.match(/^ref:\s+refs\/heads\/([^\s]+)\s+HEAD$/)
    if (match?.[1]) return match[1]
  }

  const show = runCaptureAllowFailure("git", ["remote", "show", "origin"])
  if (show.status === 0 && show.stdout) {
    const headLine = show.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("HEAD branch:"))
    if (headLine) {
      const fromShow = headLine.slice("HEAD branch:".length).trim()
      if (fromShow) return fromShow
    }
  }

  return DEFAULT_BRANCH_FALLBACK
}

function fetchOriginDefaultBranch(branch) {
  run("git", ["fetch", "origin", branch, "--quiet"])
}

function assertHeadMatchesOriginDefaultBranch(branch) {
  const head = runCapture("git", ["rev-parse", "HEAD"])
  const originDefault = runCapture("git", ["rev-parse", `origin/${branch}`])
  if (head !== originDefault) {
    throw new Error(
      `HEAD does not match origin/${branch}. Push ${branch} and wait for CI on that exact commit before releasing.`
    )
  }
}

function listCiRunsForHead(headSha) {
  const output = runCapture("gh", [
    "run",
    "list",
    "--workflow",
    REQUIRED_CI_WORKFLOW,
    "--commit",
    headSha,
    "--limit",
    "20",
    "--json",
    "databaseId,status,conclusion,headSha,event,createdAt,url"
  ])
  const runs = parseJson(output || "[]", "gh run list")
  if (!Array.isArray(runs)) {
    throw new Error("Unexpected gh run list response shape.")
  }
  return runs
    .filter((runEntry) => runEntry && runEntry.headSha === headSha && runEntry.event === "push")
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
}

function readCiRunDetails(runId) {
  const output = runCapture("gh", ["run", "view", String(runId), "--json", "status,conclusion,jobs,url"])
  const details = parseJson(output || "{}", "gh run view")
  if (!details || typeof details !== "object") {
    throw new Error("Unexpected gh run view response shape.")
  }
  return details
}

function assertRequiredCiJobsSucceeded(details) {
  const jobs = Array.isArray(details.jobs) ? details.jobs : []
  for (const requiredJob of REQUIRED_CI_JOBS) {
    const matching = jobs.find((job) => job && job.name === requiredJob)
    if (!matching) {
      throw new Error(`Required CI job missing in ${REQUIRED_CI_WORKFLOW}: ${requiredJob}`)
    }
    if (matching.conclusion !== "success") {
      throw new Error(`Required CI job is not successful (${requiredJob}): ${matching.conclusion ?? "unknown"}`)
    }
  }
}

function assertRemoteCiGreenForHead(defaultBranch) {
  if (shouldSkipRemoteCiGate()) {
    process.stdout.write(
      `Skipping remote CI gate because ${REMOTE_CI_BYPASS_ENV}=1. Use only for emergency/manual release recovery.\n`
    )
    return
  }

  if (!hasGhCli() || !hasGhAuth()) {
    throw new Error("gh CLI with authenticated session is required to confirm remote CI status before release.")
  }

  fetchOriginDefaultBranch(defaultBranch)
  assertHeadMatchesOriginDefaultBranch(defaultBranch)

  const head = runCapture("git", ["rev-parse", "HEAD"])
  const runs = listCiRunsForHead(head)
  if (runs.length === 0) {
    throw new Error(
      `No ${REQUIRED_CI_WORKFLOW} push run found for HEAD (${head}). Wait for CI to complete on ${defaultBranch} before releasing.`
    )
  }

  const latestRun = runs[0]
  const details = readCiRunDetails(latestRun.databaseId)
  if (details.status !== "completed" || details.conclusion !== "success") {
    throw new Error(
      `Latest ${REQUIRED_CI_WORKFLOW} run is not green for HEAD (${head}): status=${details.status}, conclusion=${details.conclusion}. ${details.url ?? ""}`
    )
  }
  assertRequiredCiJobsSucceeded(details)
  process.stdout.write(`Remote CI gate passed for HEAD (${head}). ${details.url ?? ""}\n`)
}

function listReleaseRunsForTag(tag, headSha) {
  const output = runCapture("gh", [
    "run",
    "list",
    "--workflow",
    RELEASE_WORKFLOW,
    "--branch",
    tag,
    "--event",
    "push",
    "--limit",
    "20",
    "--json",
    "databaseId,status,conclusion,headBranch,headSha,createdAt,url"
  ])
  const runs = parseJson(output || "[]", "gh run list (release)")
  if (!Array.isArray(runs)) {
    throw new Error("Unexpected gh run list response shape for release workflow.")
  }
  return runs
    .filter((runEntry) => runEntry && runEntry.headBranch === tag && (!headSha || runEntry.headSha === headSha))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
}

function waitForReleaseWorkflowSuccess(tag, headSha) {
  const maxAttempts = 420
  const delayMs = 10_000

  process.stdout.write(`Waiting for ${RELEASE_WORKFLOW} to complete for ${tag}...\n`)
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const latest = listReleaseRunsForTag(tag, headSha)[0]
    if (!latest) {
      process.stdout.write(`  release workflow not visible yet (attempt ${attempt}/${maxAttempts})\n`)
      sleep(delayMs)
      continue
    }
    if (latest.status !== "completed") {
      process.stdout.write(`  release workflow status=${latest.status} (attempt ${attempt}/${maxAttempts})\n`)
      sleep(delayMs)
      continue
    }
    if (latest.conclusion !== "success") {
      throw new ReleaseWorkflowFailureError(tag, latest.conclusion, latest.url)
    }
    process.stdout.write(`Release workflow succeeded for ${tag}. ${latest.url ?? ""}\n`)
    return
  }
  throw new Error(
    `Timed out waiting for ${RELEASE_WORKFLOW} completion for ${tag}. ` +
      "The release workflow may still be running; check Actions and release logs."
  )
}

function waitForGitHubRelease(repoSlug, tag) {
  const maxAttempts = 240
  const delayMs = 15_000

  process.stdout.write(`Waiting for GitHub release ${tag} in ${repoSlug}...\n`)
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = run("gh", ["release", "view", tag, "--repo", repoSlug, "--json", "url", "--jq", ".url"], {
      capture: true,
      allowFailure: true
    })
    if ((result.status ?? 1) === 0) {
      const url = result.stdout?.trim()
      if (url) {
        process.stdout.write(`GitHub release live: ${url}\n`)
        return
      }
    }
    process.stdout.write(`  release not visible yet (attempt ${attempt}/${maxAttempts})\n`)
    sleep(delayMs)
  }

  throw new Error(
    `Timed out waiting for GitHub release ${tag} visibility in ${repoSlug}. ` +
      "The release workflow may still be running; check Actions and release logs."
  )
}

function getNpmPublishStatus(tag, headSha) {
  if (!hasGhCli() || !hasGhAuth()) return "unknown"
  try {
    const latest = listReleaseRunsForTag(tag, headSha)[0]
    if (!latest?.databaseId) return "unknown"
    const details = readCiRunDetails(latest.databaseId)
    const jobs = Array.isArray(details.jobs) ? details.jobs : []
    const publishJob = jobs.find((job) => job && job.name === "Publish to npm")
    if (publishJob?.conclusion === "success") return "success"
    if (publishJob?.conclusion) return "not_published"
    return "unknown"
  } catch {
    return "unknown"
  }
}

function rollbackFailedRelease(defaultBranch, tag) {
  process.stderr.write(`Attempting automatic rollback for failed release ${tag}...\n`)
  run("git", ["fetch", "origin", defaultBranch, "--quiet"])

  const originHead = runCapture("git", ["rev-parse", `origin/${defaultBranch}`])
  const tagLookup = runCaptureAllowFailure("git", ["rev-list", "-n", "1", tag])
  if (tagLookup.status !== 0 || !tagLookup.stdout) {
    throw new Error(`Cannot auto-rollback ${tag}: tag not found locally.`)
  }
  const tagSha = tagLookup.stdout
  if (originHead !== tagSha) {
    throw new Error(
      `Cannot auto-rollback ${tag}: origin/${defaultBranch} (${originHead}) is not the tagged commit (${tagSha}).`
    )
  }

  const localHead = runCapture("git", ["rev-parse", "HEAD"])
  if (localHead !== originHead) {
    throw new Error(
      `Cannot auto-rollback ${tag}: local HEAD (${localHead}) differs from origin/${defaultBranch} (${originHead}).`
    )
  }

  run("git", ["revert", "--no-edit", tagSha])
  run("git", ["push", "--atomic", "origin", defaultBranch, `:refs/tags/${tag}`])
  run("git", ["tag", "-d", tag], { allowFailure: true })
  process.stderr.write(`Rollback complete for ${tag}: reverted ${defaultBranch} and removed tag from origin.\n`)
}

function assertCleanWorkingTree() {
  const porcelain = runCapture("git", ["status", "--porcelain"])
  if (porcelain.length > 0) {
    throw new Error("Working tree is not clean. Commit or stash changes before releasing.")
  }
}

function assertDefaultBranch(branch) {
  const currentBranch = runCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"])
  if (currentBranch !== branch) {
    throw new Error(`Releases must run from ${branch}. Current branch: ${currentBranch}`)
  }
}

function readVersion() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"))
  if (!pkg || typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error("Unable to read package version from package.json")
  }
  return pkg.version
}

function main() {
  process.stdout.write(`Starting ${bump} release flow...\n`)
  assertCleanWorkingTree()
  const defaultBranch = resolveDefaultBranch()
  releaseAttemptState.defaultBranch = defaultBranch
  assertDefaultBranch(defaultBranch)
  const remoteUrl = runCapture("git", ["config", "--get", "remote.origin.url"])
  const repoSlug = parseRepoSlug(remoteUrl)
  if (!repoSlug) {
    throw new Error(
      `Unable to parse GitHub repo slug from remote.origin.url: ${remoteUrl || "<empty>"}. ` +
        "Use a GitHub origin URL such as git@github.com:owner/repo.git or https://github.com/owner/repo.git."
    )
  }
  assertRemoteCiGreenForHead(defaultBranch)

  process.stdout.write("Running verify...\n")
  run("npm", ["run", "verify"])

  process.stdout.write(`Bumping ${bump} version...\n`)
  run("npm", ["version", bump, "-m", "release: v%s"])

  const version = readVersion()
  const tag = `v${version}`
  releaseAttemptState.tag = tag
  const releaseHead = runCapture("git", ["rev-parse", "HEAD"])
  releaseAttemptState.releaseHead = releaseHead
  process.stdout.write(`Created ${tag}. Pushing ${defaultBranch} and tags...\n`)
  run("git", ["push", "origin", defaultBranch, "--follow-tags"])
  releaseAttemptState.pushed = true

  if (!hasGhCli() || !hasGhAuth()) {
    process.stdout.write(
      `Push complete. Release workflow triggered for ${tag}. ` +
        "Install/authenticate gh CLI to auto-wait for GitHub release visibility.\n"
    )
    return
  }

  waitForReleaseWorkflowSuccess(tag, releaseHead)
  waitForGitHubRelease(repoSlug, tag)
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (releaseAttemptState.pushed && releaseAttemptState.tag && releaseAttemptState.defaultBranch) {
    try {
      if (error instanceof ReleaseWorkflowFailureError) {
        const publishStatus = getNpmPublishStatus(releaseAttemptState.tag, releaseAttemptState.releaseHead)
        if (publishStatus === "success") {
          console.error(
            `Skipping auto-rollback for ${releaseAttemptState.tag}: npm publish already succeeded in release workflow.`
          )
        } else if (publishStatus === "unknown") {
          console.error(
            `Skipping auto-rollback for ${releaseAttemptState.tag}: publish status is unknown; manual triage required to avoid rollbacking a published version.`
          )
        } else {
          rollbackFailedRelease(releaseAttemptState.defaultBranch, releaseAttemptState.tag)
        }
      } else {
        console.error(`Skipping auto-rollback for ${releaseAttemptState.tag}: failure is not a release-workflow failure.`)
      }
    } catch (rollbackError) {
      const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
      console.error(`Automatic rollback failed: ${rollbackMessage}`)
    }
  }
  console.error(`Release failed: ${message}`)
  process.exit(1)
}
