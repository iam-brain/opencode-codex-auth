import path from "node:path"

const fromSpecifierPattern = /(from\s+["'])(\.{1,2}\/[^"'\n]+)(["'])/g
const dynamicImportSpecifierPattern = /(import\(\s*["'])(\.{1,2}\/[^"'\n]+)(["']\s*\))/g
const sideEffectSpecifierPattern = /(?:^|[;{}])\s*import\s+["'](\.{1,2}\/[^"'\n]+)["']/gm

function maskKeepLines(char) {
  return char === "\n" ? "\n" : " "
}

function consumeTemplateInterpolation(input, startIndex) {
  let output = ""
  let state = "code"
  let escaped = false
  let regexEscaped = false
  let regexInCharClass = false
  let prevSignificantChar
  const templateReturnDepths = []
  let depth = 1
  let index = startIndex

  const isRegexStart = () => {
    if (!prevSignificantChar) return true
    return /[([{=,:;!&|?+\-*%^~<>]/.test(prevSignificantChar)
  }

  while (index < input.length && depth > 0) {
    const char = input[index]
    const next = input[index + 1]

    if (state === "lineComment") {
      if (char === "\n") {
        state = "code"
        output += "\n"
      } else {
        output += " "
      }
      index += 1
      continue
    }

    if (state === "blockComment") {
      if (char === "*" && next === "/") {
        output += "  "
        index += 2
        state = "code"
      } else {
        output += maskKeepLines(char)
        index += 1
      }
      continue
    }

    if (state === "singleQuote") {
      output += maskKeepLines(char)
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === "'") {
        state = "code"
      }
      index += 1
      continue
    }

    if (state === "doubleQuote") {
      output += maskKeepLines(char)
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === '"') {
        state = "code"
      }
      index += 1
      continue
    }

    if (state === "template") {
      output += maskKeepLines(char)
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === "$" && next === "{") {
        output += " "
        index += 2
        depth += 1
        templateReturnDepths.push(depth - 1)
        state = "code"
        prevSignificantChar = undefined
        continue
      } else if (char === "`") {
        state = "code"
      }
      index += 1
      continue
    }

    if (state === "regex") {
      output += maskKeepLines(char)
      if (regexEscaped) {
        regexEscaped = false
        index += 1
        continue
      }
      if (char === "\\") {
        regexEscaped = true
        index += 1
        continue
      }
      if (char === "[" && !regexInCharClass) {
        regexInCharClass = true
        index += 1
        continue
      }
      if (char === "]" && regexInCharClass) {
        regexInCharClass = false
        index += 1
        continue
      }
      if (char === "/" && !regexInCharClass) {
        state = "code"
        prevSignificantChar = "/"
      }
      index += 1
      continue
    }

    if (char === "/" && next === "/") {
      output += "  "
      index += 2
      state = "lineComment"
      continue
    }

    if (char === "/" && next === "*") {
      output += "  "
      index += 2
      state = "blockComment"
      continue
    }

    if (char === "/" && next !== "/" && next !== "*" && isRegexStart()) {
      output += " "
      state = "regex"
      regexEscaped = false
      regexInCharClass = false
      index += 1
      continue
    }

    if (char === "'") {
      output += " "
      state = "singleQuote"
      escaped = false
      index += 1
      continue
    }

    if (char === '"') {
      output += " "
      state = "doubleQuote"
      escaped = false
      index += 1
      continue
    }

    if (char === "`") {
      output += " "
      state = "template"
      escaped = false
      index += 1
      continue
    }

    if (char === "{") {
      depth += 1
    } else if (char === "}") {
      depth -= 1
      const templateDepth = templateReturnDepths[templateReturnDepths.length - 1]
      if (templateDepth === depth) {
        templateReturnDepths.pop()
        if (depth > 0) {
          state = "template"
        }
      }
    }

    output += maskKeepLines(char)
    if (!/\s/.test(char)) {
      prevSignificantChar = char
    }
    index += 1
  }

  return {
    consumed: output,
    endIndex: Math.max(startIndex, index - 1)
  }
}

export function stripCommentsKeepLines(input) {
  let output = ""
  let state = "code"
  let escaped = false
  let regexEscaped = false
  let regexInCharClass = false
  let prevSignificantChar

  const isRegexStart = () => {
    if (!prevSignificantChar) return true
    return /[([{=,:;!&|?+\-*%^~<>]/.test(prevSignificantChar)
  }

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
      } else if (char === "$" && next === "{") {
        output += "{"
        const interpolation = consumeTemplateInterpolation(input, index + 2)
        output += interpolation.consumed
        index = interpolation.endIndex
      } else if (char === "`") {
        state = "code"
      }
      continue
    }

    if (state === "regex") {
      output += char
      if (regexEscaped) {
        regexEscaped = false
        continue
      }
      if (char === "\\") {
        regexEscaped = true
        continue
      }
      if (char === "[" && !regexInCharClass) {
        regexInCharClass = true
        continue
      }
      if (char === "]" && regexInCharClass) {
        regexInCharClass = false
        continue
      }
      if (char === "/" && !regexInCharClass) {
        state = "code"
        prevSignificantChar = "/"
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

    if (char === "/" && next !== "/" && next !== "*" && isRegexStart()) {
      output += char
      state = "regex"
      regexEscaped = false
      regexInCharClass = false
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
    if (!/\s/.test(char)) {
      prevSignificantChar = char
    }
  }

  return output
}

function collectOffenders(
  content,
  filePath,
  allowedRuntimeExtensions,
  specifierPattern,
  specifierIndex,
  out,
  options = {}
) {
  specifierPattern.lastIndex = 0
  let match
  while ((match = specifierPattern.exec(content)) !== null) {
    const specifier = match[specifierIndex]
    if (!specifier) continue
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) continue
    if (allowedRuntimeExtensions.has(path.extname(specifier))) continue

    const keywordOffset = options.lineFromImportKeyword === true ? Math.max(0, match[0].indexOf("import")) : 0
    const line = content.slice(0, match.index + keywordOffset).split("\n").length
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
  collectOffenders(scan, filePath, allowedRuntimeExtensions, sideEffectSpecifierPattern, 1, offenders, {
    lineFromImportKeyword: true
  })

  return offenders
}
