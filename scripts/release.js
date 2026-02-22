#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

const VALID_BUMPS = new Set(["patch", "minor", "major"])
const bump = process.argv[2] ?? "patch"
const REQUIRED_CI_WORKFLOW = "ci.yml"
const REQUIRED_CI_JOBS = [
  "Verify on Node.js 20.x",
  "Verify on Node.js 22.x",
  "Package Smoke Test",
  "Windows Runtime Hardening",
  "Security Audit"
]
const REMOTE_CI_BYPASS_ENV = "RELEASE_SKIP_REMOTE_CI_GATE"

if (!VALID_BUMPS.has(bump)) {
  console.error(`Invalid release bump "${bump}". Use one of: patch, minor, major.`)
  process.exit(1)
}

function run(command, args, opts = {}) {
  const capture = opts.capture === true
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
  })

  if (result.error) {
    throw result.error
  }

  const status = result.status ?? 1
  if (status !== 0 && opts.allowFailure !== true) {
    if (capture && result.stderr) {
      process.stderr.write(result.stderr)
    }
    throw new Error(`Command failed (${status}): ${command} ${args.join(" ")}`)
  }

  return result
}

function runCapture(command, args) {
  return run(command, args, { capture: true }).stdout?.trim() ?? ""
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

function parseRepoSlug(remoteUrl) {
  const ssh = remoteUrl.match(/^git@github\.com:(.+?)(?:\.git)?$/)
  if (ssh?.[1]) return ssh[1]
  const https = remoteUrl.match(/^https:\/\/github\.com\/(.+?)(?:\.git)?$/)
  if (https?.[1]) return https[1]
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

function fetchOriginMain() {
  run("git", ["fetch", "origin", "main", "--quiet"])
}

function assertHeadMatchesOriginMain() {
  const head = runCapture("git", ["rev-parse", "HEAD"])
  const originMain = runCapture("git", ["rev-parse", "origin/main"])
  if (head !== originMain) {
    throw new Error("HEAD does not match origin/main. Push main and wait for CI on that exact commit before releasing.")
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

function assertRemoteCiGreenForHead() {
  if (shouldSkipRemoteCiGate()) {
    process.stdout.write(
      `Skipping remote CI gate because ${REMOTE_CI_BYPASS_ENV}=1. Use only for emergency/manual release recovery.\n`
    )
    return
  }

  if (!hasGhCli() || !hasGhAuth()) {
    throw new Error("gh CLI with authenticated session is required to confirm remote CI status before release.")
  }

  fetchOriginMain()
  assertHeadMatchesOriginMain()

  const head = runCapture("git", ["rev-parse", "HEAD"])
  const runs = listCiRunsForHead(head)
  if (runs.length === 0) {
    throw new Error(
      `No ${REQUIRED_CI_WORKFLOW} push run found for HEAD (${head}). Wait for CI to complete on main before releasing.`
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

function waitForGitHubRelease(repoSlug, tag) {
  const maxAttempts = 40
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

  throw new Error(`Timed out waiting for GitHub release ${tag}. Check Actions and release workflow logs.`)
}

function assertCleanWorkingTree() {
  const porcelain = runCapture("git", ["status", "--porcelain"])
  if (porcelain.length > 0) {
    throw new Error("Working tree is not clean. Commit or stash changes before releasing.")
  }
}

function assertMainBranch() {
  const branch = runCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"])
  if (branch !== "main") {
    throw new Error(`Releases must run from main. Current branch: ${branch}`)
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
  assertMainBranch()
  assertRemoteCiGreenForHead()

  process.stdout.write("Running verify...\n")
  run("npm", ["run", "verify"])

  process.stdout.write(`Bumping ${bump} version...\n`)
  run("npm", ["version", bump, "-m", "release: v%s"])

  const version = readVersion()
  const tag = `v${version}`
  process.stdout.write(`Created ${tag}. Pushing main and tags...\n`)
  run("git", ["push", "origin", "main", "--follow-tags"])

  const remoteUrl = runCapture("git", ["config", "--get", "remote.origin.url"])
  const repoSlug = parseRepoSlug(remoteUrl)

  if (!repoSlug || !hasGhCli() || !hasGhAuth()) {
    process.stdout.write(
      `Push complete. Release workflow triggered for ${tag}. ` +
        "Install/authenticate gh CLI to auto-wait for GitHub release visibility.\n"
    )
    return
  }

  waitForGitHubRelease(repoSlug, tag)
}

try {
  main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Release failed: ${message}`)
  process.exit(1)
}
