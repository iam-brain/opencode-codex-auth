#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const configPath = process.argv[2]
  ? path.resolve(ROOT, process.argv[2])
  : path.resolve(ROOT, "scripts/file-size-allowlist.json")

const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
const sourceCap = Number(config.sourceCap ?? 400)
const testCap = Number(config.testCap ?? 500)
const sourceAllowlist = config.sourceAllowlist ?? {}
const testAllowlist = config.testAllowlist ?? {}
const SOURCE_FILE_RE = /\.(?:[cm]?ts|[cm]?js)$/

function walk(dir, includeFile) {
  const out = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relPath = path.relative(ROOT, fullPath).replace(/\\/g, "/")
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue
      out.push(...walk(fullPath, includeFile))
      continue
    }
    if (entry.isFile() && includeFile(relPath)) out.push(relPath)
  }
  return out
}

function lineCount(filePath) {
  return fs.readFileSync(path.resolve(ROOT, filePath), "utf8").split("\n").length
}

const sourceRoots = ["index.ts", "lib", "bin", "scripts"]
const sourceFiles = []
for (const root of sourceRoots) {
  const abs = path.resolve(ROOT, root)
  if (!fs.existsSync(abs)) continue
  const stat = fs.statSync(abs)
  if (stat.isFile() && SOURCE_FILE_RE.test(root)) sourceFiles.push(root)
  if (stat.isDirectory()) sourceFiles.push(...walk(abs, (relPath) => SOURCE_FILE_RE.test(relPath)))
}

const testRoot = path.resolve(ROOT, "test")
const testFiles = fs.existsSync(testRoot) ? walk(testRoot, (relPath) => relPath.endsWith(".test.ts")) : []

const violations = []

for (const filePath of sourceFiles.sort((a, b) => a.localeCompare(b))) {
  const lines = lineCount(filePath)
  const allowed = Number(sourceAllowlist[filePath] ?? sourceCap)
  if (lines > allowed) {
    violations.push(`${filePath}: ${lines} lines exceeds allowed ${allowed}`)
  }
}

for (const filePath of testFiles.sort((a, b) => a.localeCompare(b))) {
  const lines = lineCount(filePath)
  const allowed = Number(testAllowlist[filePath] ?? testCap)
  if (lines > allowed) {
    violations.push(`${filePath}: ${lines} lines exceeds allowed ${allowed}`)
  }
}

if (violations.length > 0) {
  console.error("File size policy violation(s):")
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log(`File size policy OK. Caps: source<=${sourceCap}, tests<=${testCap}.`)
