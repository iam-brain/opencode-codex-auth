#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { findExtensionlessRelativeImportOffenders } from "./lib/esm-import-guard.mjs"

const distDir = path.resolve("dist")
const allowedRuntimeExtensions = new Set([".js", ".json", ".node", ".mjs", ".cjs"])

if (!fs.existsSync(distDir) || !fs.statSync(distDir).isDirectory()) {
  console.error("dist/ does not exist. Run npm run build first.")
  process.exit(1)
}

const files = []
const stack = [distDir]
while (stack.length > 0) {
  const dir = stack.pop()
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      stack.push(entryPath)
    } else if (entry.isFile() && (entryPath.endsWith(".js") || entryPath.endsWith(".mjs") || entryPath.endsWith(".cjs"))) {
      files.push(entryPath)
    }
  }
}

const offenders = []

for (const filePath of files) {
  const content = fs.readFileSync(filePath, "utf8")
  offenders.push(...findExtensionlessRelativeImportOffenders(filePath, content, allowedRuntimeExtensions))
}

if (offenders.length > 0) {
  console.error("Found extensionless relative imports in dist output:")
  for (const offender of offenders) {
    console.error(`- ${offender.file}:${offender.line} -> ${offender.specifier}`)
  }
  process.exit(1)
}

console.log("dist output uses fully specified relative import specifiers.")
