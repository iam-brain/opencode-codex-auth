import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type { Logger } from "../logger"

const execFileAsync = promisify(execFile)

export type BrowserOpenInvocation = {
  command: string
  args: string[]
}

export function browserOpenInvocationFor(
  url: string,
  platform: NodeJS.Platform = process.platform
): BrowserOpenInvocation {
  if (platform === "darwin") {
    return { command: "open", args: [url] }
  }
  if (platform === "win32") {
    return { command: "rundll32", args: ["url.dll,FileProtocolHandler", url] }
  }
  return { command: "xdg-open", args: [url] }
}

export async function tryOpenUrlInBrowser(input: {
  url: string
  log?: Logger
  onEvent?: (event: string, meta?: Record<string, unknown>) => void
}): Promise<boolean> {
  if (process.env.OPENCODE_NO_BROWSER === "1") return false
  if (process.env.VITEST || process.env.NODE_ENV === "test") return false

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
