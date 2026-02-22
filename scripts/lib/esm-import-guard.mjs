import path from "node:path"

const fromSpecifierPattern = /(from\s+["'])(\.{1,2}\/[^"'\n]+)(["'])/g
const dynamicImportSpecifierPattern = /(import\(\s*["'])(\.{1,2}\/[^"'\n]+)(["']\s*\))/g
const sideEffectSpecifierPattern = /^\s*import\s+["'](\.{1,2}\/[^"'\n]+)["']/gm

function stripCommentsKeepLines(input) {
  let output = ""
  let state = "code"
  let escaped = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    const next = input[index + 1]

    if (state === "lineComment") {
      if (char === "\n") {
        state = "code"
        output += "\n"
      } else {
        output += " "
      }
      continue
    }

    if (state === "blockComment") {
      if (char === "*" && next === "/") {
        output += "  "
        index += 1
        state = "code"
      } else {
        output += char === "\n" ? "\n" : " "
      }
      continue
    }

    if (state === "singleQuote") {
      output += char
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === "'") {
        state = "code"
      }
      continue
    }

    if (state === "doubleQuote") {
      output += char
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === '"') {
        state = "code"
      }
      continue
    }

    if (state === "template") {
      output += char
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === "`") {
        state = "code"
      }
      continue
    }

    if (char === "/" && next === "/") {
      output += "  "
      index += 1
      state = "lineComment"
      continue
    }

    if (char === "/" && next === "*") {
      output += "  "
      index += 1
      state = "blockComment"
      continue
    }

    if (char === "'") {
      output += char
      state = "singleQuote"
      continue
    }

    if (char === '"') {
      output += char
      state = "doubleQuote"
      continue
    }

    if (char === "`") {
      output += char
      state = "template"
      continue
    }

    output += char
  }

  return output
}

function collectOffenders(content, filePath, allowedRuntimeExtensions, specifierPattern, specifierIndex, out) {
  specifierPattern.lastIndex = 0
  let match
  while ((match = specifierPattern.exec(content)) !== null) {
    const specifier = match[specifierIndex]
    if (!specifier) continue
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue
    if (allowedRuntimeExtensions.has(path.extname(specifier))) continue

    const line = content.slice(0, match.index).split("\n").length
    out.push({
      file: path.relative(process.cwd(), filePath),
      line,
      specifier
    })
  }
}

export function findExtensionlessRelativeImportOffenders(filePath, content, allowedRuntimeExtensions) {
  const scan = stripCommentsKeepLines(content)
  const offenders = []

  collectOffenders(scan, filePath, allowedRuntimeExtensions, fromSpecifierPattern, 2, offenders)
  collectOffenders(scan, filePath, allowedRuntimeExtensions, dynamicImportSpecifierPattern, 2, offenders)
  collectOffenders(scan, filePath, allowedRuntimeExtensions, sideEffectSpecifierPattern, 1, offenders)

  return offenders
}
