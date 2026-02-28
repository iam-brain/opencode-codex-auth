import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { createRequestSnapshots } from "../lib/request-snapshots"

describe("request snapshots", () => {
  const previousXdg = process.env.XDG_CONFIG_HOME
  afterEach(() => {
    if (previousXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = previousXdg
    }
  })

  it("does not persist request body when captureBodies is false", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const snapshots = createRequestSnapshots({ enabled: true, dir: root, captureBodies: false })

    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer super-secret-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: "gpt-5.3-codex", input: "private" })
    })

    await snapshots.captureRequest("outbound-attempt", request, { attempt: 1 })

    const files = await fs.readdir(root)
    const filePath = path.join(root, files.find((file) => file.includes("request-1-outbound-attempt"))!)
    const payload = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      body?: unknown
      headers: Record<string, string>
    }

    expect(payload.body).toBeUndefined()
    expect(payload.headers.authorization).toBe("Bearer [redacted]")
  })

  it("redacts token-like values in raw non-JSON body fallback", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const snapshots = createRequestSnapshots({ enabled: true, dir: root, captureBodies: true })

    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer super-secret-token",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body:
        "access_token=abc123&refresh_token=def456&idToken=ghi789&prompt_cache_key=ses_snap_2&session_id=ses_2&chatgpt_account_id=acc_2"
    })

    await snapshots.captureRequest("outbound-attempt", request, { attempt: 2 })

    const files = await fs.readdir(root)
    const filePath = path.join(root, files.find((file) => file.includes("request-1-outbound-attempt"))!)
    const payload = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      body?: unknown
    }

    expect(payload.body).toBe(
      "access_token=[redacted]&refresh_token=[redacted]&idToken=[redacted]&prompt_cache_key=[redacted]&session_id=[redacted]&chatgpt_account_id=[redacted]"
    )
  })

  it("writes redacted request snapshots when enabled", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const snapshots = createRequestSnapshots({ enabled: true, dir: root, captureBodies: true })

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
        refreshToken: "refresh-secret",
        session_id: "ses_snap_1",
        account_id: "acc_123"
      })
    })

    await snapshots.captureRequest("outbound-attempt", request, { attempt: 1 })

    const files = await fs.readdir(root)
    expect(files.some((file) => file.includes("request-1-outbound-attempt"))).toBe(true)
    expect(files).toContain("live-headers.jsonl")

    const filePath = path.join(root, files.find((file) => file.includes("request-1-outbound-attempt"))!)
    const payload = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      headers: Record<string, string>
      body: Record<string, unknown>
      meta?: { attempt?: number }
    }

    expect(payload.meta?.attempt).toBe(1)
    expect(payload.headers.authorization).toBe("Bearer [redacted]")
    expect(payload.headers["chatgpt-account-id"]).toBe("[redacted]")
    expect(payload.body.prompt_cache_key).toBe("[redacted]")
    expect(payload.body.access_token).toBe("[redacted]")
    expect(payload.body.accessToken).toBe("[redacted]")
    expect(payload.body.refreshToken).toBe("[redacted]")
    expect(payload.body.session_id).toBe("[redacted]")
    expect(payload.body.account_id).toBe("[redacted]")

    const liveHeadersRaw = await fs.readFile(path.join(root, "live-headers.jsonl"), "utf8")
    const liveHeaders = liveHeadersRaw
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { headers: Record<string, string>; prompt_cache_key?: string })

    expect(liveHeaders).toHaveLength(1)
    expect(liveHeaders[0]?.headers.authorization).toBe("Bearer [redacted]")
    expect(liveHeaders[0]?.headers["chatgpt-account-id"]).toBe("[redacted]")
    expect(liveHeaders[0]?.prompt_cache_key).toBe("[redacted]")

    const requestMode = (await fs.stat(filePath)).mode & 0o777
    const liveHeadersMode = (await fs.stat(path.join(root, "live-headers.jsonl"))).mode & 0o777
    if (process.platform !== "win32") {
      expect(requestMode).toBe(0o600)
      expect(liveHeadersMode).toBe(0o600)
    }
  })

  it("redacts session and account identifier headers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const snapshots = createRequestSnapshots({ enabled: true, dir: root, captureBodies: true })

    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer super-secret-token",
        "ChatGPT-Account-Id": "acc_sensitive",
        session_id: "ses_sensitive",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: "gpt-5.3-codex" })
    })

    await snapshots.captureRequest("outbound-attempt", request, { attempt: 1 })

    const files = await fs.readdir(root)
    const filePath = path.join(root, files.find((file) => file.includes("request-1-outbound-attempt"))!)
    const payload = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      headers: Record<string, string>
    }

    expect(payload.headers.authorization).toBe("Bearer [redacted]")
    expect(payload.headers["chatgpt-account-id"]).toBe("[redacted]")
    expect(payload.headers.session_id).toBe("[redacted]")
  })

  it("redacts token-like custom header names", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const snapshots = createRequestSnapshots({ enabled: true, dir: root, captureBodies: false })

    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: {
        "x-auth-token": "abc123",
        "x-session-token": "ses_secret",
        "x-csrf-token": "csrf_secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({ model: "gpt-5.3-codex" })
    })

    await snapshots.captureRequest("outbound-attempt", request)

    const files = await fs.readdir(root)
    const filePath = path.join(root, files.find((file) => file.includes("request-1-outbound-attempt"))!)
    const payload = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      headers: Record<string, string>
    }

    expect(payload.headers["x-auth-token"]).toBe("[redacted]")
    expect(payload.headers["x-session-token"]).toBe("[redacted]")
    expect(payload.headers["x-csrf-token"]).toBe("[redacted]")
  })

  it("redacts sensitive metadata fields and URL query values", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const snapshots = createRequestSnapshots({ enabled: true, dir: root, captureBodies: false })

    const request = new Request(
      "https://chatgpt.com/backend-api/codex/responses?session_id=ses_query&access_token=at_query&x=1",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer super-secret-token",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ model: "gpt-5.3-codex" })
      }
    )

    await snapshots.captureRequest("outbound-attempt", request, {
      identityKey: "acc_1|user@example.com|plus",
      accountLabel: "user@example.com (plus)",
      sessionKey: "ses_sensitive",
      safeMeta: "ok"
    })

    const files = await fs.readdir(root)
    const filePath = path.join(root, files.find((file) => file.includes("request-1-outbound-attempt"))!)
    const payload = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      url: string
      meta?: {
        identityKey?: string
        accountLabel?: string
        sessionKey?: string
        safeMeta?: string
      }
    }

    expect(payload.url).toContain("session_id=%5Bredacted%5D")
    expect(payload.url).toContain("access_token=%5Bredacted%5D")
    expect(payload.meta?.identityKey).toBe("[redacted]")
    expect(payload.meta?.accountLabel).toBe("[redacted]")
    expect(payload.meta?.sessionKey).toBe("[redacted]")
    expect(payload.meta?.safeMeta).toBe("ok")
  })

  it("redacts sensitive metadata fields on response snapshots", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const snapshots = createRequestSnapshots({ enabled: true, dir: root, captureBodies: false })

    const response = new Response("ok", {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    })

    await snapshots.captureResponse("outbound-response", response, {
      identityKey: "acc_1|user@example.com|plus",
      accountLabel: "user@example.com (plus)",
      sessionKey: "ses_sensitive",
      safeMeta: "ok"
    })

    const files = await fs.readdir(root)
    const filePath = path.join(root, files.find((file) => file.includes("response-1-outbound-response"))!)
    const payload = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      meta?: {
        identityKey?: string
        accountLabel?: string
        sessionKey?: string
        safeMeta?: string
      }
    }

    expect(payload.meta?.identityKey).toBe("[redacted]")
    expect(payload.meta?.accountLabel).toBe("[redacted]")
    expect(payload.meta?.sessionKey).toBe("[redacted]")
    expect(payload.meta?.safeMeta).toBe("ok")
  })

  it("does not allow metadata to override reserved snapshot fields", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const snapshots = createRequestSnapshots({ enabled: true, dir: root, captureBodies: false })

    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.3-codex" })
    })

    await snapshots.captureRequest("outbound-attempt", request, {
      body: "leak",
      headers: { authorization: "Bearer bad" },
      url: "https://example.com"
    })

    const files = await fs.readdir(root)
    const filePath = path.join(root, files.find((file) => file.includes("request-1-outbound-attempt"))!)
    const payload = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      url: string
      body?: unknown
      meta?: Record<string, unknown>
    }

    expect(payload.url).toBe("https://chatgpt.com/backend-api/codex/responses")
    expect(payload.body).toBeUndefined()
    expect(payload.meta).toEqual({})
  })

  it("redacts token-like strings in metadata values", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const snapshots = createRequestSnapshots({ enabled: true, dir: root, captureBodies: false })

    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.3-codex" })
    })

    await snapshots.captureRequest("outbound-attempt", request, {
      error:
        "authorization: Bearer top-secret access_token=abc refresh_token=def apiKey=xyz clientSecret=secret \"authorizationCode\":\"abc\""
    })

    const files = await fs.readdir(root)
    const filePath = path.join(root, files.find((file) => file.includes("request-1-outbound-attempt"))!)
    const payload = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      meta?: { error?: string }
    }

    expect(payload.meta?.error).toContain("authorization: Bearer [redacted]")
    expect(payload.meta?.error).toContain("access_token=[redacted]")
    expect(payload.meta?.error).toContain("refresh_token=[redacted]")
    expect(payload.meta?.error).toContain("apiKey=[redacted]")
    expect(payload.meta?.error).toContain("clientSecret=[redacted]")
    expect(payload.meta?.error).toContain('"authorizationCode":"[redacted]"')
  })

  it("redacts code and state query params in snapshot URL", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const snapshots = createRequestSnapshots({ enabled: true, dir: root, captureBodies: false })

    const request = new Request("https://chatgpt.com/backend-api/codex/responses?code=abc&state=def&x=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.3-codex" })
    })

    await snapshots.captureRequest("outbound-attempt", request)

    const files = await fs.readdir(root)
    const filePath = path.join(root, files.find((file) => file.includes("request-1-outbound-attempt"))!)
    const payload = JSON.parse(await fs.readFile(filePath, "utf8")) as { url: string }

    expect(payload.url).toContain("code=%5Bredacted%5D")
    expect(payload.url).toContain("state=%5Bredacted%5D")
    expect(payload.url).toContain("x=1")
  })

  it("redacts apiKey-like query params in snapshot URL", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const snapshots = createRequestSnapshots({ enabled: true, dir: root, captureBodies: false })

    const request = new Request("https://chatgpt.com/backend-api/codex/responses?apiKey=abc&clientSecret=def", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.3-codex" })
    })

    await snapshots.captureRequest("outbound-attempt", request)

    const files = await fs.readdir(root)
    const filePath = path.join(root, files.find((file) => file.includes("request-1-outbound-attempt"))!)
    const payload = JSON.parse(await fs.readFile(filePath, "utf8")) as { url: string }

    expect(payload.url).toContain("apiKey=%5Bredacted%5D")
    expect(payload.url).toContain("clientSecret=%5Bredacted%5D")
  })

  it("sanitizes stage names to keep snapshot writes within snapshot root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const snapshots = createRequestSnapshots({ enabled: true, dir: root, captureBodies: false })

    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.3-codex" })
    })

    await snapshots.captureRequest("../outside/../../attempt", request)

    const files = await fs.readdir(root)
    expect(files.some((file) => file.includes(".."))).toBe(false)
    expect(files.some((file) => file.includes("request-1-outside-attempt"))).toBe(true)
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

  it("uses XDG config root for default logs path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const xdgRoot = path.join(root, "xdg")
    process.env.XDG_CONFIG_HOME = xdgRoot

    const snapshots = createRequestSnapshots({ enabled: true, captureBodies: false })
    await snapshots.captureRequest(
      "outbound-attempt",
      new Request("https://chatgpt.com/backend-api/codex/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-5.3-codex", input: "hello" })
      })
    )

    const expectedLogDir = path.join(xdgRoot, "opencode", "logs", "codex-plugin")
    const files = await fs.readdir(expectedLogDir)
    expect(files).toContain("live-headers.jsonl")
  })

  it("redacts forwarded header values in snapshots", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const snapshots = createRequestSnapshots({ enabled: true, dir: root, captureBodies: false })

    const request = new Request("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: {
        forwarded: "for=203.0.113.9;proto=https",
        "x-forwarded-for": "203.0.113.10",
        "content-type": "application/json"
      },
      body: JSON.stringify({ model: "gpt-5.3-codex" })
    })

    await snapshots.captureRequest("outbound-attempt", request)

    const files = await fs.readdir(root)
    const filePath = path.join(root, files.find((file) => file.includes("request-1-outbound-attempt"))!)
    const payload = JSON.parse(await fs.readFile(filePath, "utf8")) as {
      headers: Record<string, string>
    }

    expect(payload.headers.forwarded).toBe("[redacted]")
    expect(payload.headers["x-forwarded-for"]).toBe("[redacted]")
  })
})
