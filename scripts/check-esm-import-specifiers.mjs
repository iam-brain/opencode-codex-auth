#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { findExtensionlessRelativeImportOffenders } from "./lib/esm-import-guard.mjs"

const roots = ["index.ts", "lib", "bin"]
const sourceExtensions = new Set([".ts", ".mts"])
const allowedRuntimeExtensions = new Set([".js", ".json", ".node", ".mjs", ".cjs"])

function collectFiles(rootPath) {
  const abs = path.resolve(rootPath)
  if (!fs.existsSync(abs)) return []

  const stat = fs.statSync(abs)
  if (stat.isFile()) {
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
      } else if (entry.isFile() && sourceExtensions.has(path.extname(entryPath))) {
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
  const lines = content.split("\n")
  const badImport = /^\s*import\s+(?!type\b).*\sfrom\s+["']@opencode-ai\/plugin["']/
  for (let index = 0; index < lines.length; index += 1) {
    if (!badImport.test(lines[index])) continue
    offenders.push({
      file: "index.ts",
      line: index + 1,
      specifier: TOOL_IMPORT_VIOLATION
    })
  }
}

for (const root of roots) {
  for (const filePath of collectFiles(root)) {
    const content = fs.readFileSync(filePath, "utf8")
    offenders.push(...findExtensionlessRelativeImportOffenders(filePath, content, allowedRuntimeExtensions))
    collectToolImportViolations(filePath, content)
  }
}

if (offenders.length > 0) {
  console.error("Found extensionless local ESM import specifiers:")
  for (const offender of offenders) {
    console.error(`- ${offender.file}:${offender.line} -> ${offender.specifier}`)
  }
  process.exit(1)
}

console.log("All local ESM import specifiers are fully specified.")
