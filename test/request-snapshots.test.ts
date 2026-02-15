import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import lockfile from "proper-lockfile"

import { describe, expect, it } from "vitest"

import { createRequestSnapshots } from "../lib/request-snapshots"

describe("request snapshots", () => {
  it("writes redacted request snapshots when enabled", async () => {
    const baseRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const root = path.join(baseRoot, "nested")
    const snapshots = createRequestSnapshots({ enabled: true, dir: root })

    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer super-secret-token",
        "ChatGPT-Account-Id": "acc_123",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.3-codex",
        prompt_cache_key: "ses_snap_1",
        access_token: "should-redact",
        accessToken: "should-redact-too",
        refreshToken: "refresh-secret"
      })
    })

    await snapshots.captureRequest("outbound-attempt", request, {
      attempt: 1,
      sessionKey: "ses_secret",
      identityKey: "acc_123|user@example.com|plus",
      accountLabel: "user@example.com (plus)"
    })

    const files = await fs.readdir(root)
    expect(files.some((file) => file.includes("request-1-outbound-attempt"))).toBe(true)
    expect(files).toContain("live-headers.jsonl")

    const filePath = path.join(root, files.find((file) => file.includes("request-1-outbound-attempt"))!)
    const payload = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      headers: Record<string, string>
      body: Record<string, unknown>
      attempt: number
      url?: string
      sessionKey?: string
      identityKey?: string
      accountLabel?: string
    }

    expect(payload.attempt).toBe(1)
    expect(payload.url).toBe("https://chatgpt.com/backend-api/codex/responses")
    expect(payload.headers.authorization).toBe("Bearer [redacted]")
    expect(payload.headers["chatgpt-account-id"]).toBe("[redacted]")
    expect(payload.body.prompt_cache_key).toBe("ses_snap_1")
    expect(payload.body.access_token).toBe("[redacted]")
    expect(payload.body.accessToken).toBe("[redacted]")
    expect(payload.body.refreshToken).toBe("[redacted]")
    expect(payload.sessionKey).toBe("[redacted]")
    expect(payload.identityKey).toBe("[redacted]")
    expect(payload.accountLabel).toBe("[redacted]")

    const liveHeadersRaw = await fs.readFile(path.join(root, "live-headers.jsonl"), "utf8")
    const liveHeaders = liveHeadersRaw
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { headers: Record<string, string>; prompt_cache_key?: string })

    expect(liveHeaders).toHaveLength(1)
    expect(liveHeaders[0]?.headers.authorization).toBe("Bearer [redacted]")
    expect(liveHeaders[0]?.prompt_cache_key).toBe("ses_snap_1")

    const requestMode = (await fs.stat(filePath)).mode & 0o777
    const liveHeadersMode = (await fs.stat(path.join(root, "live-headers.jsonl"))).mode & 0o777
    const dirMode = (await fs.stat(root)).mode & 0o777
    expect(requestMode).toBe(0o600)
    expect(liveHeadersMode).toBe(0o600)
    expect(dirMode & 0o077).toBe(0)
  })

  it("redacts URL query string in snapshots", async () => {
    const baseRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-url-"))
    const root = path.join(baseRoot, "nested")
    const snapshots = createRequestSnapshots({ enabled: true, dir: root })

    const request = new Request("https://api.openai.com/v1/responses?access_token=secret&x=1#frag", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: "gpt-5.3-codex" })
    })

    await snapshots.captureRequest("with-query", request)

    const files = await fs.readdir(root)
    const snapshot = files.find((file) => file.includes("request-1-with-query"))
    expect(snapshot).toBeDefined()
    const filePath = path.join(root, snapshot as string)
    const payload = JSON.parse(await fs.readFile(filePath, "utf8")) as { url: string }
    expect(payload.url).toBe("https://api.openai.com/v1/responses?[redacted]")
  })

  it("skips writing files when disabled", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const snapshots = createRequestSnapshots({ enabled: false, dir: root })

    await snapshots.captureRequest("before-auth", new Request("https://example.com"))

    const files = await fs.readdir(root)
    expect(files).toHaveLength(0)
  })

  it("prunes old snapshot files when retention cap is exceeded", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const snapshots = createRequestSnapshots({
      enabled: true,
      dir: root,
      maxSnapshotFiles: 2
    })

    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.3-codex" })
    })

    await snapshots.captureRequest("one", request)
    await snapshots.captureRequest("two", request)
    await snapshots.captureRequest("three", request)

    const files = (await fs.readdir(root)).filter((file) => file.includes("request-"))
    expect(files.length).toBeLessThanOrEqual(2)
    expect(files.some((file) => file.includes("three"))).toBe(true)
  })

  it("rotates live headers log when size cap is exceeded", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const snapshots = createRequestSnapshots({
      enabled: true,
      dir: root,
      maxLiveHeadersBytes: 10
    })

    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.3-codex" })
    })

    await snapshots.captureRequest("one", request)
    await snapshots.captureRequest("two", request)

    const files = await fs.readdir(root)
    expect(files).toContain("live-headers.jsonl")
    expect(files).toContain("live-headers.jsonl.1")
  })

  it("waits for snapshot lock before writing files", async () => {
    const baseRoot = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const root = path.join(baseRoot, "locked")
    await fs.mkdir(root, { recursive: true })

    const release = await lockfile.lock(path.join(root, ".request-snapshots.lock"), {
      realpath: false,
      retries: 0
    })

    const snapshots = createRequestSnapshots({ enabled: true, dir: root })
    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.3-codex" })
    })

    const pending = snapshots.captureRequest("locked", request)
    await new Promise((resolve) => setTimeout(resolve, 25))

    const beforeRelease = (await fs.readdir(root)).some((file) => file.includes("request-1-locked"))
    expect(beforeRelease).toBe(false)

    await release()
    await pending

    const afterRelease = (await fs.readdir(root)).some((file) => file.includes("request-1-locked"))
    expect(afterRelease).toBe(true)
  })
})
