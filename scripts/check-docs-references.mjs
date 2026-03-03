#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"

const ROOT = process.cwd()
const DOCS_ROOT = path.resolve(ROOT, "docs")

const LOCAL_ONLY_PREFIXES = ["docs/plans/", "docs/research/"]
const EXCLUDED_FILES = new Set(["docs/development/REFACTOR_SCORECARD.md"])
const CANONICAL_ROOT_DOC = "README.md"

const DELETED_TEST_PATHS = [
  "test/config.test.ts",
  "test/fetch-orchestrator.test.ts",
  "test/model-catalog.test.ts",
  "test/openai-loader-fetch.prompt-cache-key.test.ts"
]

const REMOVED_TOOLING_PATTERNS = [
  { label: "eslint.config.mjs", regex: /\beslint\.config\.mjs\b/i },
  { label: ".prettierrc", regex: /\.prettierrc\b/i },
  { label: ".prettierignore", regex: /\.prettierignore\b/i },
  { label: "eslint", regex: /\beslint\b/i },
  { label: "prettier", regex: /\bprettier\b/i }
]

const HISTORICAL_CONTEXT = /\b(history|historical|legacy|archive|archived|migration|migrated|previous|former)\b/i

function normalizeRelPath(inputPath) {
  return inputPath.replace(/\\/g, "/")
}

function isLocalOnlyPath(relPath) {
  return LOCAL_ONLY_PREFIXES.some((prefix) => relPath.startsWith(prefix))
}

function isCanonicalDoc(relPath) {
  if (EXCLUDED_FILES.has(relPath)) return false
  if (isLocalOnlyPath(relPath)) return false
  if (relPath === CANONICAL_ROOT_DOC) return true
  return relPath.startsWith("docs/") && relPath.endsWith(".md")
}

function walk(dirPath) {
  const out = []
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    const relPath = normalizeRelPath(path.relative(ROOT, fullPath))
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue
      if (isLocalOnlyPath(`${relPath}/`)) continue
      out.push(...walk(fullPath))
      continue
    }
    if (entry.isFile() && relPath.endsWith(".md") && isCanonicalDoc(relPath)) {
      out.push(relPath)
    }
  }
  return out
}

function collectCanonicalDocs() {
  const tracked = []
  try {
    const output = execSync("git ls-files -- README.md docs", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    })
    tracked.push(
      ...output
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  } catch {
    // Fallback for non-git environments.
    const rootReadme = path.resolve(ROOT, CANONICAL_ROOT_DOC)
    if (fs.existsSync(rootReadme)) tracked.push(CANONICAL_ROOT_DOC)
    if (fs.existsSync(DOCS_ROOT)) tracked.push(...walk(DOCS_ROOT))
  }

  return [...new Set(tracked)]
    .filter((relPath) => relPath.endsWith(".md") && isCanonicalDoc(relPath))
    .sort((left, right) => left.localeCompare(right))
}

function hasHistoricalContext(line) {
  return HISTORICAL_CONTEXT.test(line)
}

function parseMarkdownLinkTarget(rawTarget) {
  const trimmed = rawTarget.trim()
  if (!trimmed) return ""
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1).trim()
  }
  const match = trimmed.match(/^(\S+)/)
  return match?.[1] ?? trimmed
}

function isExternalLink(target) {
  return /^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(target)
}

function resolveLinkPath(docRelPath, target) {
  const noFragment = target.split("#")[0].split("?")[0]
  if (!noFragment) return null
  if (noFragment.startsWith("/")) {
    return path.resolve(ROOT, noFragment.slice(1))
  }
  const docAbsPath = path.resolve(ROOT, docRelPath)
  return path.resolve(path.dirname(docAbsPath), noFragment)
}

const docs = collectCanonicalDocs()
const violations = []

for (const relPath of docs) {
  const absPath = path.resolve(ROOT, relPath)
  const content = fs.readFileSync(absPath, "utf8")
  const lines = content.split("\n")

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineNumber = lineIndex + 1
    const line = lines[lineIndex]

    for (const deletedPath of DELETED_TEST_PATHS) {
      if (line.includes(deletedPath)) {
        violations.push(`${relPath}:${lineNumber} references deleted test path ${deletedPath}`)
      }
    }

    if (!hasHistoricalContext(line)) {
      for (const pattern of REMOVED_TOOLING_PATTERNS) {
        if (pattern.regex.test(line)) {
          violations.push(`${relPath}:${lineNumber} references removed lint tooling "${pattern.label}"`)
        }
      }
    }

    const markdownLinkRegex = /\[[^\]]*]\(([^)]+)\)/g
    let linkMatch = markdownLinkRegex.exec(line)
    while (linkMatch) {
      const rawTarget = linkMatch[1] ?? ""
      const target = parseMarkdownLinkTarget(rawTarget)
      if (target && !target.startsWith("#") && !isExternalLink(target)) {
        const resolved = resolveLinkPath(relPath, target)
        if (resolved && !fs.existsSync(resolved)) {
          violations.push(`${relPath}:${lineNumber} has broken link target ${target}`)
        }
      }
      linkMatch = markdownLinkRegex.exec(line)
    }
  }
}

if (violations.length > 0) {
  console.error("Documentation reference check failed:")
  for (const violation of violations) {
    console.error(`- ${violation}`)
  }
  process.exit(1)
}

console.log(`Documentation reference check passed for ${docs.length} canonical docs.`)
