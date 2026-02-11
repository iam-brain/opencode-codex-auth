import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { createRequestSnapshots } from "../lib/request-snapshots"

describe("request snapshots", () => {
  it("writes redacted request snapshots when enabled", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
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
        access_token: "should-redact"
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
      attempt: number
    }

    expect(payload.attempt).toBe(1)
    expect(payload.headers.authorization).toBe("Bearer [redacted]")
    expect(payload.headers["chatgpt-account-id"]).toBe("acc_123")
    expect(payload.body.prompt_cache_key).toBe("ses_snap_1")
    expect(payload.body.access_token).toBe("[redacted]")

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
    expect(requestMode).toBe(0o600)
    expect(liveHeadersMode).toBe(0o600)
  })

  it("skips writing files when disabled", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-codex-auth-snapshots-"))
    const snapshots = createRequestSnapshots({ enabled: false, dir: root })

    await snapshots.captureRequest("before-auth", new Request("https://example.com"))

    const files = await fs.readdir(root)
    expect(files).toHaveLength(0)
  })
})
