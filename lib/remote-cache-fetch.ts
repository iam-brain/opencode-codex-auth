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
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

export async function fetchRemoteText(
  request: RemoteTextFetchRequest,
  options: RemoteFetchOptions = {}
): Promise<RemoteTextFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? 5000))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers: Record<string, string> = {}
    if (request.etag) {
      headers["if-none-match"] = request.etag
    }
    const response = await fetchImpl(request.url, {
      method: "GET",
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      signal: controller.signal
    })

    if (response.status === 304) {
      return {
        key: request.key,
        status: "not_modified",
        etag: request.etag
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
    return {
      key: request.key,
      status: "ok",
      text,
      etag,
      finalUrl: response.url || request.url
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
  options: RemoteFetchOptions = {}
): Promise<RemoteTextFetchResult[]> {
  return Promise.all(input.requests.map((request) => fetchRemoteText(request, options)))
}
