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
      param: "request",
      source: "request.url.protocol",
      hint: "Use an https:// OpenAI or ChatGPT backend URL."
    })
  }

  if (url.username || url.password) {
    throw new PluginFatalError({
      message:
        `Blocked outbound request to "${url.hostname}" with URL-embedded credentials. ` +
        "This plugin only proxies OpenAI/ChatGPT backend traffic without URL credentials.",
      status: 400,
      type: "disallowed_outbound_credentials",
      param: "request",
      source: "request.url",
      hint: "Remove username/password credentials from the request URL."
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
      param: "request",
      source: "request.url.port",
      hint: "Use the default HTTPS port or omit the explicit port."
    })
  }

  if (isAllowedOpenAIOutboundHost(url.hostname)) return

  throw new PluginFatalError({
    message:
      `Blocked outbound request to "${url.hostname}". ` + "This plugin only proxies OpenAI/ChatGPT backend traffic.",
    status: 400,
    type: "disallowed_outbound_host",
    param: "request",
    source: "request.url.host",
    hint: "Use an OpenAI or ChatGPT backend host such as api.openai.com or chatgpt.com."
  })
}
