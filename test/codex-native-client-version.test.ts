import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import { __testOnly } from "../lib/codex-native"

async function makeTmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "codex-client-version-test-"))
}

describe("codex client version resolution", () => {
  it("reads version from codex client version cache file", async () => {
    const dir = await makeTmpDir()
    const cacheFile = path.join(dir, "codex-client-version.json")
    await fs.writeFile(cacheFile, JSON.stringify({ version: "0.98.0", fetchedAt: Date.now() }), "utf8")

    expect(__testOnly.resolveCodexClientVersion(cacheFile)).toBe("0.98.0")
  })

  it("falls back to 0.97.0 when cache file is missing", async () => {
    const dir = await makeTmpDir()
    const cacheFile = path.join(dir, "missing.json")
    expect(__testOnly.resolveCodexClientVersion(cacheFile)).toBe("0.97.0")
  })

  it("refreshes stale cache from GitHub release tag", async () => {
    const dir = await makeTmpDir()
    const cacheFile = path.join(dir, "codex-client-version.json")
    await fs.writeFile(cacheFile, JSON.stringify({ version: "0.98.0", fetchedAt: 1 }), "utf8")

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ tag_name: "rust-v0.99.1" }), { status: 200 })
    })
    const fetchImpl = fetchMock as unknown as typeof fetch

    const version = await __testOnly.refreshCodexClientVersionFromGitHub(undefined, {
      cacheFilePath: cacheFile,
      fetchImpl,
      now: () => 2 * 60 * 60 * 1000,
      allowInTest: true
    })

    expect(version).toBe("0.99.1")
    expect(fetchMock.mock.calls.length).toBe(1)
    expect(__testOnly.resolveCodexClientVersion(cacheFile)).toBe("0.99.1")
  })

  it("falls back to HTML release endpoint when API payload is unusable", async () => {
    const dir = await makeTmpDir()
    const cacheFile = path.join(dir, "codex-client-version.json")
    await fs.writeFile(cacheFile, JSON.stringify({ version: "0.98.0", fetchedAt: 1 }), "utf8")

    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const endpoint = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url
      if (endpoint.includes("/repos/openai/codex/releases/latest")) {
        return new Response(JSON.stringify({ tag_name: "" }), { status: 200 })
      }
      if (endpoint.includes("/openai/codex/releases/latest")) {
        return new Response('<a href="/openai/codex/releases/tag/rust-v0.99.2">latest</a>', {
          status: 200,
          headers: { "content-type": "text/html" }
        })
      }
      throw new Error(`unexpected URL: ${endpoint}`)
    })

    const version = await __testOnly.refreshCodexClientVersionFromGitHub(undefined, {
      cacheFilePath: cacheFile,
      fetchImpl: fetchMock as unknown as typeof fetch,
      now: () => 2 * 60 * 60 * 1000,
      allowInTest: true
    })

    expect(version).toBe("0.99.2")
    expect(fetchMock.mock.calls.length).toBe(2)
  })

  it("rejects redirected release HTML final URL from non-allowlisted host", async () => {
    const dir = await makeTmpDir()
    const cacheFile = path.join(dir, "codex-client-version.json")
    await fs.writeFile(cacheFile, JSON.stringify({ version: "0.98.0", fetchedAt: 1 }), "utf8")

    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const endpoint = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url
      if (endpoint.includes("/repos/openai/codex/releases/latest")) {
        return new Response(JSON.stringify({ tag_name: "" }), { status: 200 })
      }
      if (endpoint.includes("/openai/codex/releases/latest")) {
        return new Response('<a href="/openai/codex/releases/tag/rust-v0.99.2">latest</a>', {
          status: 200,
          headers: { "content-type": "text/html" }
        })
      }
      throw new Error(`unexpected URL: ${endpoint}`)
    })

    const originalFetch = fetchMock
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const response = await originalFetch(url, init)
      const endpoint = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url
      if (endpoint.includes("/openai/codex/releases/latest")) {
        Object.defineProperty(response, "url", { value: "https://evil.example.invalid/tag" })
      }
      return response
    }) as typeof fetch

    const version = await __testOnly.refreshCodexClientVersionFromGitHub(undefined, {
      cacheFilePath: cacheFile,
      fetchImpl,
      now: () => 2 * 60 * 60 * 1000,
      allowInTest: true
    })

    expect(version).toBe("0.98.0")
  })

  it("does not refresh when cache entry is still fresh", async () => {
    const dir = await makeTmpDir()
    const cacheFile = path.join(dir, "codex-client-version.json")
    await fs.writeFile(cacheFile, JSON.stringify({ version: "0.98.0", fetchedAt: 10_000 }), "utf8")

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ tag_name: "rust-v0.99.1" }), { status: 200 })
    })
    const fetchImpl = fetchMock as unknown as typeof fetch

    const version = await __testOnly.refreshCodexClientVersionFromGitHub(undefined, {
      cacheFilePath: cacheFile,
      fetchImpl,
      now: () => 10_001,
      allowInTest: true
    })

    expect(version).toBe("0.98.0")
    expect(fetchMock.mock.calls.length).toBe(0)
  })
})
