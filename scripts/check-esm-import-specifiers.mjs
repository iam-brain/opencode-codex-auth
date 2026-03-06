#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { findExtensionlessRelativeImportOffenders, stripCommentsKeepLines } from "./lib/esm-import-guard.mjs"

const isDistMode = process.argv.includes("--dist")
const roots = isDistMode ? ["dist"] : ["index.ts", "lib", "bin"]
const sourceExtensions = new Set([".ts", ".mts"])
const allowedRuntimeExtensions = new Set([".js", ".json", ".node", ".mjs", ".cjs"])

if (isDistMode) {
  const distRoot = path.resolve("dist")
  if (!fs.existsSync(distRoot)) {
    console.error("dist output not found. Run `npm run build` before checking dist ESM imports.")
    process.exit(1)
  }
}

function collectFiles(rootPath) {
  const abs = path.resolve(rootPath)
  if (!fs.existsSync(abs)) return []

  const stat = fs.statSync(abs)
  if (stat.isFile()) {
    if (isDistMode) {
      return allowedRuntimeExtensions.has(path.extname(abs)) ? [abs] : []
    }
    return sourceExtensions.has(path.extname(abs)) ? [abs] : []
  }

  const files = []
  const stack = [abs]
  while (stack.length > 0) {
    const dir = stack.pop()
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(entryPath)
      } else if (
        entry.isFile() &&
        (isDistMode
          ? allowedRuntimeExtensions.has(path.extname(entryPath))
          : sourceExtensions.has(path.extname(entryPath)))
      ) {
        files.push(entryPath)
      }
    }
  }

  return files
}

const offenders = []
const TOOL_IMPORT_VIOLATION =
  'index.ts runtime tool import must use "@opencode-ai/plugin/tool" for NodeNext compatibility'

function collectToolImportViolations(filePath, content) {
  if (path.relative(process.cwd(), filePath) !== "index.ts") return
  const scan = stripCommentsKeepLines(content)
  const badImport = /^\s*import\s+(?!type\b)[\s\S]*?\sfrom\s+["']@opencode-ai\/plugin["']/gm
  const badRequire = /\brequire\(\s*["']@opencode-ai\/plugin["']\s*\)/gm
  const badDynamicImport = /\bimport\(\s*["']@opencode-ai\/plugin["']\s*\)/gm
  let match
  while ((match = badImport.exec(scan)) !== null) {
    const line = scan.slice(0, match.index).split("\n").length
    offenders.push({
      file: "index.ts",
      line,
      specifier: TOOL_IMPORT_VIOLATION
    })
  }
  while ((match = badRequire.exec(scan)) !== null) {
    const line = scan.slice(0, match.index).split("\n").length
    offenders.push({
      file: "index.ts",
      line,
      specifier: TOOL_IMPORT_VIOLATION
    })
  }
  while ((match = badDynamicImport.exec(scan)) !== null) {
    const line = scan.slice(0, match.index).split("\n").length
    offenders.push({
      file: "index.ts",
      line,
      specifier: TOOL_IMPORT_VIOLATION
    })
  }
}

for (const root of roots) {
  for (const filePath of collectFiles(root)) {
    const content = fs.readFileSync(filePath, "utf8")
    offenders.push(...findExtensionlessRelativeImportOffenders(filePath, content, allowedRuntimeExtensions))
    if (!isDistMode) {
      collectToolImportViolations(filePath, content)
    }
  }
}

if (offenders.length > 0) {
  console.error(
    isDistMode
      ? "Found extensionless relative imports in dist output:"
      : "Found extensionless local ESM import specifiers:"
  )
  for (const offender of offenders) {
    console.error(`- ${offender.file}:${offender.line} -> ${offender.specifier}`)
  }
  process.exit(1)
}

console.log(
  isDistMode
    ? "dist output uses fully specified relative import specifiers."
    : "All local ESM import specifiers are fully specified."
)
