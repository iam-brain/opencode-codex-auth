import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type { Logger } from "../logger.js"

const execFileAsync = promisify(execFile)

export type BrowserOpenInvocation = {
  command: string
  args: string[]
}

export function normalizeAllowedOrigins(input: string[] | undefined): Set<string> {
  const out = new Set<string>()
  if (!input) return out
  for (const candidate of input) {
    try {
      const origin = new URL(candidate).origin
      if (origin) out.add(origin)
    } catch {
      // ignore invalid configured origin
    }
  }
  return out
}

export function isAllowedBrowserUrl(url: string, allowedOrigins: Set<string>): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false
    if (parsed.username || parsed.password) return false
    if (allowedOrigins.size > 0 && !allowedOrigins.has(parsed.origin)) return false
    return true
  } catch {
    return false
  }
}

export function browserOpenInvocationFor(
  url: string,
  platform: NodeJS.Platform = process.platform
): BrowserOpenInvocation {
  if (platform === "darwin") {
    return { command: "open", args: [url] }
  }
  if (platform === "win32") {
    return { command: "explorer.exe", args: [url] }
  }
  return { command: "xdg-open", args: [url] }
}

export async function tryOpenUrlInBrowser(input: {
  url: string
  allowedOrigins?: string[]
  log?: Logger
  onEvent?: (event: string, meta?: Record<string, unknown>) => void
}): Promise<boolean> {
  if (process.env.OPENCODE_NO_BROWSER === "1") return false
  if (process.env.VITEST || process.env.NODE_ENV === "test") return false

  const allowedOrigins = normalizeAllowedOrigins(input.allowedOrigins)
  if (!isAllowedBrowserUrl(input.url, allowedOrigins)) {
    input.onEvent?.("browser_open_blocked", {
      reason: "invalid_or_disallowed_url"
    })
    input.log?.warn("blocked auto-open oauth URL", { reason: "invalid_or_disallowed_url" })
    return false
  }

  const invocation = browserOpenInvocationFor(input.url)
  input.onEvent?.("browser_open_attempt", { command: invocation.command })

  try {
    await execFileAsync(invocation.command, invocation.args, { windowsHide: true, timeout: 5000 })
    input.onEvent?.("browser_open_success", { command: invocation.command })
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    input.onEvent?.("browser_open_failure", {
      command: invocation.command,
      error: message
    })
    input.log?.warn("failed to auto-open oauth URL", {
      command: invocation.command,
      error: message
    })
    return false
  }
}
