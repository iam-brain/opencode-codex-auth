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
const regressionTolerancePct = Number(config.regressionTolerancePct ?? 0.25)

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

function isAllZeroRef(value) {
  return typeof value === "string" && /^[0]+$/.test(value)
}

function isCoveredSourceFile(filePath) {
  return filePath === "index.ts" || (filePath.startsWith("lib/") && filePath.endsWith(".ts"))
}

function collectTouchedFilesForRange(range) {
  return parseTouchedFiles(runGitCommand(`git diff --name-only --diff-filter=ACMRTUXB ${range}`))
}

function collectTouchedStagedFiles() {
  return parseTouchedFiles(runGitCommand("git diff --cached --name-only --diff-filter=ACMRTUXB"))
}

function collectTouchedWorkingTreeFiles() {
  return parseTouchedFiles(runGitCommand("git diff --name-only --diff-filter=ACMRTUXB"))
}

function collectTouchedFiles() {
  const explicitTouchedFiles = process.env.COVERAGE_RATCHET_TOUCHED_FILES
  if (explicitTouchedFiles?.trim()) {
    return parseTouchedFiles(explicitTouchedFiles)
  }

  const rangeCandidates = []
  const explicitRange = process.env.COVERAGE_RATCHET_DIFF_RANGE?.trim()
  if (explicitRange) rangeCandidates.push(explicitRange)

  const rawBaseRef = process.env.COVERAGE_RATCHET_BASE_REF?.trim()
  const baseRef = rawBaseRef && !isAllZeroRef(rawBaseRef) ? rawBaseRef : undefined
  const headRef = process.env.COVERAGE_RATCHET_HEAD_REF?.trim() || "HEAD"
  if (baseRef) {
    rangeCandidates.push(`${baseRef}...${headRef}`)
  }

  for (const range of [...new Set(rangeCandidates)]) {
    const files = collectTouchedFilesForRange(range)
    if (files.length > 0) {
      return files
    }
  }

  const stagedFiles = collectTouchedStagedFiles()
  const workingTreeFiles = collectTouchedWorkingTreeFiles()
  const localFiles = [...new Set([...stagedFiles, ...workingTreeFiles])]
  if (localFiles.length > 0) {
    return localFiles
  }

  const singleCommitBase = runGitCommand(`git rev-parse --verify ${headRef}^`)?.trim()
  if (singleCommitBase) {
    const files = collectTouchedFilesForRange(`${singleCommitBase}...${headRef}`)
    if (files.length > 0) {
      return files
    }
  }

  return workingTreeFiles
}

const coverageByFile = toRelativeCoverageMap(summary)
const touched = new Set(collectTouchedFiles())
const regressionViolations = []
let comparedFiles = 0

for (const filePath of touched) {
  if (!isCoveredSourceFile(filePath)) continue
  const current = coverageByFile[filePath]
  const prior = baseline.files[filePath]
  if (!current) continue
  if (!prior) continue
  comparedFiles += 1

  for (const metric of ["lines", "branches", "functions", "statements"]) {
    const floor = Number(prior[metric])
    const actual = Number(current[metric])
    if (actual + regressionTolerancePct + 1e-9 < floor) {
      regressionViolations.push(`${filePath}: ${metric} regressed ${actual.toFixed(2)} < ${floor.toFixed(2)}`)
    }
  }
}

if (regressionViolations.length > 0) {
  console.error("Coverage ratchet policy violation(s):")
  for (const violation of regressionViolations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log(
  `Coverage ratchet OK. Compared ${comparedFiles} touched existing source file(s). Coverage snapshot=${summary.total.lines.pct.toFixed(2)}/${summary.total.branches.pct.toFixed(2)}/${summary.total.functions.pct.toFixed(2)}/${summary.total.statements.pct.toFixed(2)} (lines/branches/functions/statements).`
)
