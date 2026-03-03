import { isFsErrorCode } from "../cache-io.js"

export function isLoopbackRemoteAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false
  const normalized = remoteAddress.split("%")[0]?.toLowerCase()
  if (!normalized) return false
  if (normalized === "::1") return true
  if (normalized.startsWith("127.")) return true
  if (normalized.startsWith("::ffff:127.")) return true
  return false
}

export function resolveListenHosts(loopbackHost: string): string[] {
  const normalized = loopbackHost.trim().toLowerCase()
  if (normalized === "localhost") {
    return ["localhost", "127.0.0.1", "::1"]
  }
  return [loopbackHost]
}

export function shouldRetryListenWithFallback(error: unknown): boolean {
  return (
    isFsErrorCode(error, "EADDRNOTAVAIL") || isFsErrorCode(error, "EAFNOSUPPORT") || isFsErrorCode(error, "ENOTFOUND")
  )
}

export function rewriteCallbackUriHost(callbackUri: string, host: string): string {
  try {
    const url = new URL(callbackUri)
    url.hostname = host
    return url.toString()
  } catch (error) {
    if (error instanceof Error) {
      // fallback to configured callback URI when URL parsing fails
    }
    return callbackUri
  }
}
