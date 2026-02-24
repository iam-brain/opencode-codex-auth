import { describe, expect, it, vi } from "vitest"

import { fetchRemoteText, fetchRemoteTextBatch } from "../lib/remote-cache-fetch.js"

describe("remote cache fetch helper", () => {
  it("fetches text with etag", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      return new Response("hello", {
        status: 200,
        headers: { etag: 'W/"abc"' }
      })
    })

    const result = await fetchRemoteText(
      {
        key: "k1",
        url: "https://example.com/a"
      },
      { fetchImpl, timeoutMs: 1000, allowedHosts: ["example.com"] }
    )

    expect(result.status).toBe("ok")
    if (result.status !== "ok") throw new Error("expected ok")
    expect(result.text).toBe("hello")
    expect(result.etag).toBe('W/"abc"')
    expect(result.finalUrl).toBe("https://example.com/a")

    const firstCall = fetchImpl.mock.calls[0]
    const init = firstCall ? (firstCall[1] as RequestInit | undefined) : undefined
    expect(init?.redirect).toBe("manual")
  })

  it("blocks disallowed hosts", async () => {
    const fetchImpl = vi.fn(async () => new Response("hello", { status: 200 }))

    const result = await fetchRemoteText(
      {
        key: "k-host",
        url: "https://example.com/not-allowed"
      },
      { fetchImpl, timeoutMs: 1000, allowedHosts: ["raw.githubusercontent.com"] }
    )

    expect(result.status).toBe("error")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("follows allowlisted redirects", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://raw.githubusercontent.com/openai/codex/main/file.txt" }
        })
      )
      .mockResolvedValueOnce(new Response("hello", { status: 200 }))

    const result = await fetchRemoteText(
      {
        key: "k-redirect",
        url: "https://github.com/openai/codex/releases/latest"
      },
      {
        fetchImpl,
        timeoutMs: 1000,
        allowedHosts: ["github.com", "raw.githubusercontent.com"]
      }
    )

    expect(result.status).toBe("ok")
    if (result.status !== "ok") throw new Error("expected ok")
    expect(result.finalUrl).toBe("https://raw.githubusercontent.com/openai/codex/main/file.txt")
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("blocks redirects to non-allowlisted origins", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://example.com/evil" }
      })
    )

    const result = await fetchRemoteText(
      {
        key: "k-block-redirect",
        url: "https://github.com/openai/codex/releases/latest"
      },
      {
        fetchImpl,
        timeoutMs: 1000,
        allowedHosts: ["github.com", "raw.githubusercontent.com"]
      }
    )

    expect(result.status).toBe("error")
  })

  it("supports conditional not-modified fetches", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>
      expect(headers["if-none-match"]).toBe('W/"prev"')
      return new Response(null, { status: 304 })
    })

    const result = await fetchRemoteText(
      {
        key: "k2",
        url: "https://example.com/b",
        etag: 'W/"prev"'
      },
      { fetchImpl, timeoutMs: 1000, allowedHosts: ["example.com"] }
    )

    expect(result.status).toBe("not_modified")
  })

  it("captures fresh etag on 304 response", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(null, {
        status: 304,
        headers: { etag: 'W/"next"' }
      })
    })

    const result = await fetchRemoteText(
      {
        key: "k2b",
        url: "https://example.com/b",
        etag: 'W/"prev"'
      },
      { fetchImpl, timeoutMs: 1000, allowedHosts: ["example.com"] }
    )

    expect(result.status).toBe("not_modified")
    if (result.status !== "not_modified") throw new Error("expected not_modified")
    expect(result.etag).toBe('W/"next"')
  })

  it("retains previous etag when 304 has no etag", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(null, { status: 304 })
    })

    const result = await fetchRemoteText(
      {
        key: "k2c",
        url: "https://example.com/c",
        etag: 'W/"prev"'
      },
      { fetchImpl, timeoutMs: 1000, allowedHosts: ["example.com"] }
    )

    expect(result.status).toBe("not_modified")
    if (result.status !== "not_modified") throw new Error("expected not_modified")
    expect(result.etag).toBe('W/"prev"')
  })

  it("returns undefined etag when 304 has no etag and request had none", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(null, { status: 304 })
    })

    const result = await fetchRemoteText(
      {
        key: "k2d",
        url: "https://example.com/d"
      },
      { fetchImpl, timeoutMs: 1000, allowedHosts: ["example.com"] }
    )

    expect(result.status).toBe("not_modified")
    if (result.status !== "not_modified") throw new Error("expected not_modified")
    expect(result.etag).toBeUndefined()
  })

  it("fetches batches in parallel", async () => {
    const resolvers = new Map<string, (value: Response) => void>()
    const started: string[] = []

    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const endpoint = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url
      started.push(endpoint)
      return await new Promise<Response>((resolve) => {
        resolvers.set(endpoint, resolve)
      })
    })

    const batchPromise = fetchRemoteTextBatch(
      {
        requests: [
          { key: "one", url: "https://example.com/one" },
          { key: "two", url: "https://example.com/two" }
        ]
      },
      { fetchImpl, timeoutMs: 1000, allowedHosts: ["example.com"] }
    )

    await vi.waitFor(() => {
      expect(started).toHaveLength(2)
    })

    resolvers.get("https://example.com/one")?.(new Response("one", { status: 200 }))
    resolvers.get("https://example.com/two")?.(new Response("two", { status: 200 }))

    const results = await batchPromise
    expect(
      results.map((result) =>
        result.status === "ok" ? [result.key, result.status, result.text] : [result.key, result.status]
      )
    ).toEqual([
      ["one", "ok", "one"],
      ["two", "ok", "two"]
    ])
  })

  it("returns timeout status on abort", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const abortError = new Error("aborted")
          ;(abortError as Error & { name: string }).name = "AbortError"
          reject(abortError)
        })
      })
    })

    const result = await fetchRemoteText(
      {
        key: "k4",
        url: "https://example.com/slow"
      },
      { fetchImpl, timeoutMs: 1, allowedHosts: ["example.com"] }
    )

    expect(result.status).toBe("timeout")
  })
})
