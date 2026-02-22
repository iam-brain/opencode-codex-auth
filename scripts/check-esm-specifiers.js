#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const ROOT = process.cwd()
const modeArg = process.argv.find((arg) => arg.startsWith("--scope="))
const scope = modeArg ? modeArg.slice("--scope=".length) : "src"

const SOURCE_TARGETS = ["index.ts", "lib", "bin"]
const DIST_TARGET = "dist"
const DIST_EXTENSIONS = [".js", ".mjs", ".cjs", ".json", ".node"]

function isRelativeSpecifier(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../")
}

function hasKnownDistExtension(specifier) {
  return DIST_EXTENSIONS.some((ext) => specifier.endsWith(ext))
}

async function walkFiles(startPath, allowedExtensions, out) {
  const absStart = path.resolve(ROOT, startPath)
  const entries = await readdir(absStart, { withFileTypes: true })
  for (const entry of entries) {
    const absPath = path.join(absStart, entry.name)
    if (entry.isDirectory()) {
      await walkFiles(path.relative(ROOT, absPath), allowedExtensions, out)
      continue
    }
    if (allowedExtensions.some((ext) => entry.name.endsWith(ext))) {
      out.push(absPath)
    }
  }
}

async function collectFiles() {
  if (scope === "src") {
    const files = [path.resolve(ROOT, "index.ts")]
    await walkFiles("lib", [".ts"], files)
    await walkFiles("bin", [".ts"], files)
    return files
  }

  if (scope === "dist") {
    const files = []
    await walkFiles(DIST_TARGET, [".js"], files)
    return files
  }

  throw new Error(`Unknown scope \"${scope}\". Use --scope=src or --scope=dist.`)
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length
}

function addIssue(issues, relPath, line, message) {
  issues.push(`${relPath}:${line} ${message}`)
}

function checkStaticSpecifiers(content, relPath, issues) {
  const staticSpecifierRegex =
    /(?:^|\n)\s*(?:import|export)\s+[\s\S]*?\sfrom\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g

  for (const match of content.matchAll(staticSpecifierRegex)) {
    const fullMatch = match[0] ?? ""
    if (/^\s*(import|export)\s+type\b/.test(fullMatch)) continue

    const specifier = match[1] ?? match[2]
    if (!specifier || !isRelativeSpecifier(specifier)) continue

    const line = lineOf(content, match.index ?? 0)
    if (scope === "src") {
      if (!specifier.endsWith(".js")) {
        addIssue(issues, relPath, line, `relative import/export must end in .js (found \"${specifier}\")`)
      }
    } else if (!hasKnownDistExtension(specifier)) {
      addIssue(
        issues,
        relPath,
        line,
        `relative import/export in dist must have explicit file extension (found \"${specifier}\")`
      )
    }
  }
}

function checkDynamicImports(content, relPath, issues) {
  const dynamicImportRegex = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  for (const match of content.matchAll(dynamicImportRegex)) {
    const specifier = match[1]
    if (!specifier || !isRelativeSpecifier(specifier)) continue

    const line = lineOf(content, match.index ?? 0)
    if (scope === "src") {
      if (!specifier.endsWith(".js")) {
        addIssue(issues, relPath, line, `dynamic import must end in .js (found \"${specifier}\")`)
      }
    } else if (!hasKnownDistExtension(specifier)) {
      addIssue(
        issues,
        relPath,
        line,
        `dynamic import in dist must have explicit file extension (found \"${specifier}\")`
      )
    }
  }
}

function checkPluginToolImport(content, relPath, issues) {
  if (scope !== "src" || relPath !== "index.ts") return

  const lines = content.split("\n")
  const badImport = /^\s*import\s+(?!type\b).*\sfrom\s+["']@opencode-ai\/plugin["']/
  for (let i = 0; i < lines.length; i += 1) {
    if (badImport.test(lines[i])) {
      addIssue(
        issues,
        relPath,
        i + 1,
        'runtime tool import must use "@opencode-ai/plugin/tool" for NodeNext compatibility'
      )
    }
  }
}

async function main() {
  const files = await collectFiles()
  const issues = []

  for (const filePath of files) {
    const content = await readFile(filePath, "utf8")
    const relPath = path.relative(ROOT, filePath).replaceAll("\\", "/")
    checkStaticSpecifiers(content, relPath, issues)
    checkDynamicImports(content, relPath, issues)
    checkPluginToolImport(content, relPath, issues)
  }

  if (issues.length > 0) {
    process.stderr.write(`ESM specifier check failed for scope=${scope}.\n`)
    for (const issue of issues) {
      process.stderr.write(`- ${issue}\n`)
    }
    process.exit(1)
  }

  const scanned = scope === "src" ? SOURCE_TARGETS.join(", ") : DIST_TARGET
  process.stdout.write(`ESM specifier check passed for scope=${scope} (scanned: ${scanned}).\n`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`ESM specifier check crashed: ${message}\n`)
  process.exit(1)
})
