#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

const VALID_BUMPS = new Set(["patch", "minor", "major"])
const bump = process.argv[2] ?? "patch"

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
