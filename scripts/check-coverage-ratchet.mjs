#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"

const ROOT = process.cwd()
const configPath = process.argv[2]
  ? path.resolve(ROOT, process.argv[2])
  : path.resolve(ROOT, "scripts/coverage-ratchet.config.json")
const coveragePath = process.argv[3]
  ? path.resolve(ROOT, process.argv[3])
  : path.resolve(ROOT, "coverage/coverage-summary.json")

if (!fs.existsSync(coveragePath)) {
  console.error(`Coverage summary not found: ${coveragePath}`)
  process.exit(1)
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
const summary = JSON.parse(fs.readFileSync(coveragePath, "utf8"))
const baselinePath = path.resolve(ROOT, config.baselinePath)
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"))
const globalThresholds = config.globalThresholds
const regressionTolerancePct = Number(config.regressionTolerancePct ?? 0.25)

const globalViolations = []
for (const metric of ["lines", "branches", "functions", "statements"]) {
  const actual = Number(summary.total[metric]?.pct ?? 0)
  const required = Number(globalThresholds[metric] ?? 0)
  if (actual + 1e-9 < required) {
    globalViolations.push(`${metric}: ${actual.toFixed(2)} < ${required.toFixed(2)}`)
  }
}

function toRelativeCoverageMap(rawSummary) {
  const out = {}
  for (const [file, data] of Object.entries(rawSummary)) {
    if (file === "total") continue
    const rel = file.startsWith(ROOT + path.sep) ? path.relative(ROOT, file) : file
    const normalized = rel.replace(/\\/g, "/")
    out[normalized] = {
      lines: Number(data.lines.pct),
      branches: Number(data.branches.pct),
      functions: Number(data.functions.pct),
      statements: Number(data.statements.pct)
    }
  }
  return out
}

function runGitCommand(command) {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  } catch {
    return null
  }
}

function parseTouchedFiles(output) {
  if (!output) return []
  return output
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function collectTouchedFiles() {
  const rangeCandidates = []
  const explicitRange = process.env.COVERAGE_RATCHET_DIFF_RANGE?.trim()
  if (explicitRange) rangeCandidates.push(explicitRange)

  const baseRef = process.env.COVERAGE_RATCHET_BASE_REF?.trim()
  const headRef = process.env.COVERAGE_RATCHET_HEAD_REF?.trim() || "HEAD"
  if (baseRef) rangeCandidates.push(`${baseRef}...${headRef}`)

  rangeCandidates.push("origin/main...HEAD")

  const mergeBaseMain = runGitCommand("git merge-base origin/main HEAD")?.trim()
  if (mergeBaseMain) rangeCandidates.push(`${mergeBaseMain}...HEAD`)

  const mergeBaseOriginHead = runGitCommand("git merge-base origin/HEAD HEAD")?.trim()
  if (mergeBaseOriginHead) rangeCandidates.push(`${mergeBaseOriginHead}...HEAD`)

  const rootCommit = runGitCommand("git rev-list --max-parents=0 HEAD")
    ?.split("\n")
    .map((entry) => entry.trim())
    .find(Boolean)
  if (rootCommit) rangeCandidates.push(`${rootCommit}...HEAD`)

  for (const range of [...new Set(rangeCandidates)]) {
    const files = parseTouchedFiles(runGitCommand(`git diff --name-only --diff-filter=ACMRTUXB ${range}`))
    if (files.length > 0) {
      return files
    }
  }

  return parseTouchedFiles(runGitCommand("git diff --name-only --diff-filter=ACMRTUXB"))
}

const coverageByFile = toRelativeCoverageMap(summary)
const touched = new Set(collectTouchedFiles())
const regressionViolations = []
const missingBaseline = []

for (const filePath of touched) {
  if (!filePath.endsWith(".ts")) continue
  const current = coverageByFile[filePath]
  const prior = baseline.files[filePath]
  if (!current) continue
  if (!prior) {
    missingBaseline.push(filePath)
    continue
  }

  for (const metric of ["lines", "branches", "functions", "statements"]) {
    const floor = Number(prior[metric])
    const actual = Number(current[metric])
    if (actual + regressionTolerancePct + 1e-9 < floor) {
      regressionViolations.push(`${filePath}: ${metric} regressed ${actual.toFixed(2)} < ${floor.toFixed(2)}`)
    }
  }
}

if (missingBaseline.length > 0) {
  regressionViolations.push(
    ...missingBaseline
      .sort((left, right) => left.localeCompare(right))
      .map((filePath) => `${filePath}: missing coverage baseline entry (update scripts/coverage-ratchet.baseline.json)`)
  )
}

if (globalViolations.length > 0 || regressionViolations.length > 0) {
  console.error("Coverage ratchet policy violation(s):")
  for (const violation of globalViolations) {
    console.error(`- Global ${violation}`)
  }
  for (const violation of regressionViolations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log(
  `Coverage ratchet OK. Global=${summary.total.lines.pct.toFixed(2)}/${summary.total.branches.pct.toFixed(2)}/${summary.total.functions.pct.toFixed(2)}/${summary.total.statements.pct.toFixed(2)} (lines/branches/functions/statements).`
)
