import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { createShareableDebugLogger } from "../lib/shareable-debug"

describe("shareable debug logger", () => {
  it("writes shareable events with stable pseudonyms and without raw secrets", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-shareable-debug-"))
    const filePath = path.join(root, "shareable-debug.jsonl")
    const logger = createShareableDebugLogger({ enabled: true, filePath })

    const request = new Request("https://api.openai.com/v1/responses?access_token=at_secret", {
      method: "POST",
      headers: {
        Authorization: "Bearer super-secret-token",
        Cookie: "sid=session-cookie",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.4",
        input: "super private prompt",
        prompt_cache_key: "pck_secret_123"
      })
    })

    await logger.emitRotationBegin({
      authMode: "codex",
      rotationStrategy: "sticky",
      activeIdentityKey: "acc_1|user@example.com|pro",
      sessionKey: "ses_sensitive_1",
      totalAccounts: 2,
      enabledAccounts: 2
    })
    await logger.emitFetchAttemptRequest({
      authMode: "codex",
      attempt: 1,
      maxAttempts: 3,
      attemptReasonCode: "initial_attempt",
      request,
      selectedIdentityKey: "acc_1|user@example.com|pro",
      activeIdentityKey: "acc_1|user@example.com|pro",
      sessionKey: "ses_sensitive_1"
    })
    await logger.emitFetchAttemptResponse({
      authMode: "codex",
      attempt: 1,
      maxAttempts: 3,
      attemptReasonCode: "initial_attempt",
      endpoint: "https://api.openai.com/v1/responses?access_token=at_secret",
      status: 200,
      selectedIdentityKey: "acc_1|user@example.com|pro",
      sessionKey: "ses_sensitive_1"
    })

    const raw = await fs.readFile(filePath, "utf8")
    const lines = raw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(lines).toHaveLength(3)
    expect(lines[0]?.event).toBe("rotation_begin")
    expect(lines[1]?.event).toBe("fetch_attempt_request")
    expect(lines[2]?.event).toBe("fetch_attempt_response")

    expect(lines[0]?.activeIdentity).toMatch(/^ident_[0-9a-f]{8}$/)
    expect(lines[0]?.session).toMatch(/^sess_[0-9a-f]{8}$/)
    expect(lines[1]?.selectedIdentity).toBe(lines[0]?.activeIdentity)
    expect(lines[1]?.activeIdentity).toBe(lines[0]?.activeIdentity)
    expect(lines[1]?.session).toBe(lines[0]?.session)
    expect(lines[1]?.promptCacheKey).toMatch(/^pck_[0-9a-f]{8}$/)
    expect(lines[2]?.session).toBe(lines[0]?.session)
    expect(lines[1]?.endpoint).toBe("/v1/responses")
    expect(lines[2]?.endpoint).toBe("/v1/responses")

    expect(raw).not.toContain("user@example.com")
    expect(raw).not.toContain("acc_1|user@example.com|pro")
    expect(raw).not.toContain("ses_sensitive_1")
    expect(raw).not.toContain("pck_secret_123")
    expect(raw).not.toContain("super private prompt")
    expect(raw).not.toContain("super-secret-token")
    expect(raw).not.toContain("access_token=at_secret")
    expect(raw).not.toContain("session-cookie")
  })
})
