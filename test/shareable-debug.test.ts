import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { createShareableDebugLogger } from "../lib/shareable-debug"

describe("shareable debug logger", () => {
  it("writes shareable events with stable pseudonyms and without raw secrets", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-shareable-debug-"))
    const filePath = path.join(root, "shareable-debug.jsonl")
    const logger = createShareableDebugLogger({
      enabled: true,
      filePath,
      registerProcessHandlers: false
    })

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

  it("captures a bounded incident file around a trigger response", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-shareable-incident-"))
    const filePath = path.join(root, "shareable-debug.jsonl")
    const stateDir = path.join(root, "shareable-debug-state")
    const logger = createShareableDebugLogger({
      enabled: true,
      filePath,
      stateDir,
      registerProcessHandlers: false,
      incidentConfig: {
        preTriggerEventCount: 2,
        postTriggerEventCount: 2,
        segmentMaxBytes: 220,
        rollingBufferMaxBytes: 8_192,
        maxIncidentFiles: 4,
        maxIncidentBytes: 8_192
      }
    })

    const buildRequest = (promptCacheKey: string) =>
      new Request("https://api.openai.com/backend-api/codex/responses", {
        method: "POST",
        headers: {
          Authorization: "Bearer super-secret-token",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-5.4",
          input: "super private prompt",
          prompt_cache_key: promptCacheKey
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
      request: buildRequest("pck_before_1"),
      selectedIdentityKey: "acc_1|user@example.com|pro",
      activeIdentityKey: "acc_1|user@example.com|pro",
      sessionKey: "ses_sensitive_1"
    })
    await logger.emitFetchAttemptResponse({
      authMode: "codex",
      attempt: 1,
      maxAttempts: 3,
      attemptReasonCode: "initial_attempt",
      endpoint: "https://api.openai.com/backend-api/codex/responses",
      status: 429,
      selectedIdentityKey: "acc_1|user@example.com|pro",
      activeIdentityKey: "acc_1|user@example.com|pro",
      sessionKey: "ses_sensitive_1"
    })
    await logger.emitFetchAttemptRequest({
      authMode: "codex",
      attempt: 2,
      maxAttempts: 3,
      attemptReasonCode: "retry_switched_account_after_429",
      request: buildRequest("pck_after_1"),
      selectedIdentityKey: "acc_2|user@example.com|team",
      activeIdentityKey: "acc_2|user@example.com|team",
      sessionKey: "ses_sensitive_1"
    })
    await logger.emitFetchAttemptResponse({
      authMode: "codex",
      attempt: 2,
      maxAttempts: 3,
      attemptReasonCode: "retry_switched_account_after_429",
      endpoint: "https://api.openai.com/backend-api/codex/responses",
      status: 200,
      selectedIdentityKey: "acc_2|user@example.com|team",
      activeIdentityKey: "acc_2|user@example.com|team",
      sessionKey: "ses_sensitive_1"
    })

    const incidentDir = path.join(stateDir, "incidents")
    const incidents = await fs.readdir(incidentDir)
    expect(incidents).toHaveLength(1)

    const incidentRaw = await fs.readFile(path.join(incidentDir, incidents[0] ?? ""), "utf8")
    const incidentLines = incidentRaw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(incidentLines.map((line) => line.event)).toEqual([
      "rotation_begin",
      "fetch_attempt_request",
      "fetch_attempt_response",
      "fetch_attempt_request",
      "fetch_attempt_response",
      "incident_closed"
    ])
    expect(incidentRaw).not.toContain("user@example.com")
    expect(incidentRaw).not.toContain("super private prompt")
    expect(incidentRaw).not.toContain("super-secret-token")
    expect(incidentRaw).not.toContain("pck_before_1")
    const summaryRaw = await fs.readFile(filePath, "utf8")
    expect(summaryRaw).not.toContain(root)
    await expect(fs.access(path.join(stateDir, "incident-state.json"))).rejects.toThrow()
  })

  it("recovers an open incident after restart and closes it when the post window completes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-shareable-recover-"))
    const filePath = path.join(root, "shareable-debug.jsonl")
    const stateDir = path.join(root, "shareable-debug-state")

    const createLogger = () =>
      createShareableDebugLogger({
        enabled: true,
        filePath,
        stateDir,
        registerProcessHandlers: false,
        incidentConfig: {
          preTriggerEventCount: 1,
          postTriggerEventCount: 2,
          segmentMaxBytes: 220,
          rollingBufferMaxBytes: 8_192,
          maxIncidentFiles: 4,
          maxIncidentBytes: 8_192
        }
      })

    const buildRequest = (attemptReasonCode: string) =>
      new Request("https://api.openai.com/backend-api/codex/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-5.4",
          input: "super private prompt",
          prompt_cache_key: `pck_${attemptReasonCode}`
        })
      })

    const logger1 = createLogger()
    await logger1.emitFetchAttemptRequest({
      authMode: "codex",
      attempt: 1,
      maxAttempts: 3,
      attemptReasonCode: "initial_attempt",
      request: buildRequest("before"),
      selectedIdentityKey: "acc_1|user@example.com|pro",
      activeIdentityKey: "acc_1|user@example.com|pro",
      sessionKey: "ses_sensitive_restart"
    })
    await logger1.emitFetchAttemptResponse({
      authMode: "codex",
      attempt: 1,
      maxAttempts: 3,
      attemptReasonCode: "initial_attempt",
      endpoint: "https://api.openai.com/backend-api/codex/responses",
      status: 403,
      selectedIdentityKey: "acc_1|user@example.com|pro",
      activeIdentityKey: "acc_1|user@example.com|pro",
      sessionKey: "ses_sensitive_restart"
    })
    await logger1.emitFetchAttemptRequest({
      authMode: "codex",
      attempt: 2,
      maxAttempts: 3,
      attemptReasonCode: "retry_switched_account_after_429",
      request: buildRequest("after_one"),
      selectedIdentityKey: "acc_2|user@example.com|team",
      activeIdentityKey: "acc_2|user@example.com|team",
      sessionKey: "ses_sensitive_restart"
    })

    const logger2 = createLogger()
    await logger2.emitFetchAttemptResponse({
      authMode: "codex",
      attempt: 2,
      maxAttempts: 3,
      attemptReasonCode: "retry_switched_account_after_429",
      endpoint: "https://api.openai.com/backend-api/codex/responses",
      status: 200,
      selectedIdentityKey: "acc_2|user@example.com|team",
      activeIdentityKey: "acc_2|user@example.com|team",
      sessionKey: "ses_sensitive_restart"
    })

    const incidentDir = path.join(stateDir, "incidents")
    const incidents = await fs.readdir(incidentDir)
    expect(incidents).toHaveLength(1)

    const incidentRaw = await fs.readFile(path.join(incidentDir, incidents[0] ?? ""), "utf8")
    expect(incidentRaw).toContain('"event":"incident_closed"')

    const summaryRaw = await fs.readFile(filePath, "utf8")
    expect(summaryRaw).toContain('"event":"incident_recovered"')
    expect(summaryRaw).not.toContain(root)
    await expect(fs.access(path.join(stateDir, "incident-state.json"))).rejects.toThrow()
  })

  it("ignores a torn trailing segment line during restart recovery", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-shareable-torn-"))
    const filePath = path.join(root, "shareable-debug.jsonl")
    const stateDir = path.join(root, "shareable-debug-state")
    const segmentDir = path.join(stateDir, "segments")

    const createLogger = () =>
      createShareableDebugLogger({
        enabled: true,
        filePath,
        stateDir,
        registerProcessHandlers: false,
        incidentConfig: {
          preTriggerEventCount: 1,
          postTriggerEventCount: 1,
          segmentMaxBytes: 220,
          rollingBufferMaxBytes: 8_192,
          maxIncidentFiles: 4,
          maxIncidentBytes: 8_192
        }
      })

    const logger1 = createLogger()
    await logger1.emitRotationBegin({
      authMode: "codex",
      rotationStrategy: "sticky",
      activeIdentityKey: "acc_1|user@example.com|pro",
      sessionKey: "ses_torn_1",
      totalAccounts: 2,
      enabledAccounts: 2
    })

    const segmentFiles = await fs.readdir(segmentDir)
    expect(segmentFiles).toHaveLength(1)
    await fs.appendFile(path.join(segmentDir, segmentFiles[0] ?? ""), '{"seq":999,"event":"partial"')

    const logger2 = createLogger()
    await logger2.emitFetchAttemptResponse({
      authMode: "codex",
      attempt: 1,
      maxAttempts: 3,
      attemptReasonCode: "initial_attempt",
      endpoint: "https://api.openai.com/backend-api/codex/responses",
      status: 429,
      selectedIdentityKey: "acc_1|user@example.com|pro",
      activeIdentityKey: "acc_1|user@example.com|pro",
      sessionKey: "ses_torn_1"
    })

    const incidentDir = path.join(stateDir, "incidents")
    const incidents = await fs.readdir(incidentDir)
    expect(incidents).toHaveLength(1)

    const incidentRaw = await fs.readFile(path.join(incidentDir, incidents[0] ?? ""), "utf8")
    expect(incidentRaw).toContain('"event":"rotation_begin"')
    expect(incidentRaw).toContain('"event":"fetch_attempt_response"')
    expect(incidentRaw).not.toContain('"event":"partial"')
  })
})
