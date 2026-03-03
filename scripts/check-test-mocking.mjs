#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const configPath = process.argv[2]
  ? path.resolve(ROOT, process.argv[2])
  : path.resolve(ROOT, "scripts/test-mocking-allowlist.json")

const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
const allowMap = config.files ?? {}
const includeGlobs = config.include ?? ["test"]

const PATTERNS = [
  { key: "doMock", regex: /\bvi\.doMock\s*\(/g },
  { key: "mock", regex: /\bvi\.mock\s*\(/g },
  { key: "stubGlobal", regex: /\bvi\.stubGlobal\s*\(/g }
]

function walk(dir) {
  const out = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    const relPath = path.relative(ROOT, fullPath).replace(/\\/g, "/")
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue
      out.push(...walk(fullPath))
      continue
    }
    if (entry.isFile() && relPath.endsWith(".ts") && relPath.includes("test/")) {
      out.push(relPath)
    }
  }
  return out
}

function countMatches(text, regex) {
  const matches = text.match(regex)
  return matches ? matches.length : 0
}

const files = includeGlobs
  .map((rel) => path.resolve(ROOT, rel))
  .filter((abs) => fs.existsSync(abs))
  .flatMap((abs) => walk(abs))
  .filter((rel) => rel.endsWith(".test.ts") || rel.startsWith("test/helpers/"))
  .sort((a, b) => a.localeCompare(b))

const violations = []
const stats = {
  doMock: 0,
  mock: 0,
  stubGlobal: 0
}

for (const relPath of files) {
  const content = fs.readFileSync(path.resolve(ROOT, relPath), "utf8")
  const counts = {
    doMock: countMatches(content, PATTERNS[0].regex),
    mock: countMatches(content, PATTERNS[1].regex),
    stubGlobal: countMatches(content, PATTERNS[2].regex)
  }

  stats.doMock += counts.doMock
  stats.mock += counts.mock
  stats.stubGlobal += counts.stubGlobal

  const allowance = allowMap[relPath] ?? { doMock: 0, mock: 0, stubGlobal: 0 }

  for (const key of Object.keys(counts)) {
    if (counts[key] <= 0) continue
    const allowed = Number(allowance[key] ?? 0)
    if (counts[key] > allowed) {
      violations.push(`${relPath}: ${key} count ${counts[key]} exceeds allowed ${allowed}`)
    }
  }
}

if (violations.length > 0) {
  console.error("Test mocking policy violation(s):")
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  console.error("\nPolicy: no new vi.doMock/vi.mock/direct vi.stubGlobal usage outside allowlisted legacy debt.")
  process.exit(1)
}

console.log(
  `Mock policy OK. Current debt baseline: vi.doMock=${stats.doMock}, vi.mock=${stats.mock}, vi.stubGlobal=${stats.stubGlobal}.`
)
