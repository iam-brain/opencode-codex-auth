export type RemoteTextFetchRequest = {
  key: string
  url: string
  etag?: string
}

export type RemoteTextFetchResult =
  | {
      key: string
      status: "ok"
      text: string
      etag?: string
      finalUrl?: string
    }
  | {
      key: string
      status: "not_modified"
      etag?: string
    }
  | {
      key: string
      status: "timeout" | "http_error" | "error"
    }

export type RemoteFetchOptions = {
  fetchImpl?: typeof fetch
  timeoutMs?: number
  allowedHosts: string[]
  maxRedirects?: number
}

function normalizeAllowedHosts(input: string[]): Set<string> {
  const out = new Set<string>()
  for (const host of input) {
    const normalized = host.trim().toLowerCase()
    if (normalized) out.add(normalized)
  }
  return out
}

function isAllowedRemoteUrl(url: string, allowedHosts: Set<string>): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "https:") return false
    return allowedHosts.has(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

function resolveRedirectUrl(location: string, baseUrl: string): string | undefined {
  try {
    return new URL(location, baseUrl).toString()
  } catch {
    return undefined
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

export async function fetchRemoteText(
  request: RemoteTextFetchRequest,
  options: RemoteFetchOptions
): Promise<RemoteTextFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? 5000))
  const maxRedirects = Math.max(0, Math.floor(options.maxRedirects ?? 3))
  const allowedHosts = normalizeAllowedHosts(options.allowedHosts)
  if (allowedHosts.size === 0) {
    return {
      key: request.key,
      status: "error"
    }
  }
  if (!isAllowedRemoteUrl(request.url, allowedHosts)) {
    return {
      key: request.key,
      status: "error"
    }
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers: Record<string, string> = {}
    if (request.etag) {
      headers["if-none-match"] = request.etag
    }
    let targetUrl = request.url
    let response: Response | undefined

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      response = await fetchImpl(targetUrl, {
        method: "GET",
        redirect: "manual",
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        signal: controller.signal
      })

      if (!isRedirectStatus(response.status)) break
      const location = response.headers.get("location")
      if (!location) {
        return {
          key: request.key,
          status: "error"
        }
      }

      if (redirectCount >= maxRedirects) {
        return {
          key: request.key,
          status: "error"
        }
      }

      const nextUrl = resolveRedirectUrl(location, targetUrl)
      if (!nextUrl || !isAllowedRemoteUrl(nextUrl, allowedHosts)) {
        return {
          key: request.key,
          status: "error"
        }
      }
      targetUrl = nextUrl
    }

    if (!response) {
      return {
        key: request.key,
        status: "error"
      }
    }

    if (response.status === 304) {
      return {
        key: request.key,
        status: "not_modified",
        etag: response.headers.get("etag")?.trim() || request.etag
      }
    }

    if (!response.ok) {
      return {
        key: request.key,
        status: "http_error"
      }
    }

    const text = (await response.text()).trim()
    if (!text) {
      return {
        key: request.key,
        status: "error"
      }
    }

    const etag = response.headers.get("etag")?.trim() || undefined
    if (!isAllowedRemoteUrl(response.url || targetUrl, allowedHosts)) {
      return {
        key: request.key,
        status: "error"
      }
    }
    return {
      key: request.key,
      status: "ok",
      text,
      etag,
      finalUrl: response.url || targetUrl
    }
  } catch (error) {
    if (isAbortError(error)) {
      return {
        key: request.key,
        status: "timeout"
      }
    }
    return {
      key: request.key,
      status: "error"
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchRemoteTextBatch(
  input: {
    requests: RemoteTextFetchRequest[]
  },
  options: RemoteFetchOptions
): Promise<RemoteTextFetchResult[]> {
  return Promise.all(input.requests.map((request) => fetchRemoteText(request, options)))
}
