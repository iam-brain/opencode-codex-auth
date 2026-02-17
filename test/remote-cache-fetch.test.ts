import { describe, expect, it, vi } from "vitest"

import { fetchRemoteText, fetchRemoteTextBatch } from "../lib/remote-cache-fetch"

describe("remote cache fetch helper", () => {
  it("fetches text with etag", async () => {
    const fetchImpl = vi.fn(async () => {
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
      { fetchImpl, timeoutMs: 1000 }
    )

    expect(result.status).toBe("ok")
    if (result.status !== "ok") throw new Error("expected ok")
    expect(result.text).toBe("hello")
    expect(result.etag).toBe('W/"abc"')
    expect(result.finalUrl).toBe("https://example.com/a")
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
      { fetchImpl, timeoutMs: 1000 }
    )

    expect(result.status).toBe("not_modified")
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
      { fetchImpl, timeoutMs: 1000 }
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
      { fetchImpl, timeoutMs: 1 }
    )

    expect(result.status).toBe("timeout")
  })
})
