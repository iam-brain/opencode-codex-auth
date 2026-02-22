import { PluginFatalError } from "../fatal-errors.js"

const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const OPENAI_OUTBOUND_HOST_ALLOWLIST = new Set(["api.openai.com", "auth.openai.com", "chat.openai.com", "chatgpt.com"])

export function rewriteUrl(requestInput: string | URL | Request): URL {
  const parsed =
    requestInput instanceof URL
      ? requestInput
      : new URL(typeof requestInput === "string" ? requestInput : requestInput.url)

  if (isAllowedOpenAIOutboundHost(parsed.hostname) && shouldRewriteToCodexEndpoint(parsed.pathname)) {
    return new URL(CODEX_API_ENDPOINT)
  }

  return parsed
}

function shouldRewriteToCodexEndpoint(pathname: string): boolean {
  return (
    pathname === "/v1/responses" ||
    pathname === "/v1/responses/" ||
    pathname === "/v1/chat/completions" ||
    pathname === "/chat/completions" ||
    pathname === "/chat/completions/"
  )
}

function isAllowedOpenAIOutboundHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) return false
  return OPENAI_OUTBOUND_HOST_ALLOWLIST.has(normalized)
}

export function assertAllowedOutboundUrl(url: URL): void {
  const protocol = url.protocol.trim().toLowerCase()
  if (protocol !== "https:") {
    throw new PluginFatalError({
      message:
        `Blocked outbound request with unsupported protocol "${protocol || "unknown"}". ` +
        "This plugin only proxies HTTPS requests to OpenAI/ChatGPT backends.",
      status: 400,
      type: "disallowed_outbound_protocol",
      param: "request"
    })
  }

  const port = url.port.trim()
  if (port && port !== "443") {
    throw new PluginFatalError({
      message:
        `Blocked outbound request to \"${url.hostname}:${port}\". ` +
        "This plugin only proxies OpenAI/ChatGPT backend traffic over the default HTTPS port.",
      status: 400,
      type: "disallowed_outbound_port",
      param: "request"
    })
  }

  if (isAllowedOpenAIOutboundHost(url.hostname)) return

  throw new PluginFatalError({
    message:
      `Blocked outbound request to "${url.hostname}". ` + "This plugin only proxies OpenAI/ChatGPT backend traffic.",
    status: 400,
    type: "disallowed_outbound_host",
    param: "request"
  })
}
