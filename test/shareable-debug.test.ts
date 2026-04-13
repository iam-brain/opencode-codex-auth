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

  it("seals a live trigger capture incomplete when the retained prelude is already truncated", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-shareable-live-incomplete-"))
    const filePath = path.join(root, "shareable-debug.jsonl")
    const stateDir = path.join(root, "shareable-debug-state")
    const segmentsDir = path.join(stateDir, "segments")

    const logger = createShareableDebugLogger({
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

    const buildRequest = (promptCacheKey: string) =>
      new Request("https://api.openai.com/backend-api/codex/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-5.4",
          input: "super private prompt",
          prompt_cache_key: promptCacheKey
        })
      })

    await logger.emitFetchAttemptRequest({
      authMode: "codex",
      attempt: 1,
      maxAttempts: 3,
      attemptReasonCode: "initial_attempt",
      request: buildRequest("before"),
      selectedIdentityKey: "acc_1|user@example.com|pro",
      activeIdentityKey: "acc_1|user@example.com|pro",
      sessionKey: "ses_live_incomplete_1"
    })

    const [segmentFile] = await fs.readdir(segmentsDir)
    await fs.writeFile(path.join(segmentsDir, segmentFile ?? ""), "", { mode: 0o600 })

    await logger.emitFetchAttemptResponse({
      authMode: "codex",
      attempt: 1,
      maxAttempts: 3,
      attemptReasonCode: "initial_attempt",
      endpoint: "https://api.openai.com/backend-api/codex/responses",
      status: 403,
      selectedIdentityKey: "acc_1|user@example.com|pro",
      activeIdentityKey: "acc_1|user@example.com|pro",
      sessionKey: "ses_live_incomplete_1"
    })

    const incidentsDir = path.join(stateDir, "incidents")
    const [incidentFile] = await fs.readdir(incidentsDir)
    const incidentRaw = await fs.readFile(path.join(incidentsDir, incidentFile ?? ""), "utf8")
    expect(incidentRaw).toContain('"event":"incident_closed"')
    expect(incidentRaw).toContain('"incomplete":true')

    const logger2 = createShareableDebugLogger({
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
    await logger2.emitRotationCandidateSelected({
      authMode: "codex",
      selectedIdentityKey: "acc_2|user@example.com|team",
      selectedIndex: 1,
      selectedEnabled: true
    })

    const incidentFilesAfterRestart = await fs.readdir(incidentsDir)
    expect(incidentFilesAfterRestart).toHaveLength(1)
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

  it("resumes sequence numbering from the latest segment filename after a torn first line", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-shareable-seq-"))
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
      sessionKey: "ses_seq_1",
      totalAccounts: 2,
      enabledAccounts: 2
    })

    await fs.writeFile(path.join(segmentDir, "segment-0000000000000002.jsonl"), '{"seq":2', { mode: 0o600 })

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
      sessionKey: "ses_seq_1"
    })

    const summaryLines = (await fs.readFile(filePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(summaryLines.at(-1)?.seq).toBe(2)

    const latestSegmentRaw = await fs.readFile(path.join(segmentDir, "segment-0000000000000002.jsonl"), "utf8")
    expect(latestSegmentRaw).toContain('"seq":2')
    expect(latestSegmentRaw).not.toContain('{"seq":2{"seq":2')
  })

  it("reconciles a stale incident manifest against persisted post-trigger events on restart", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-shareable-manifest-"))
    const filePath = path.join(root, "shareable-debug.jsonl")
    const stateDir = path.join(root, "shareable-debug-state")
    const manifestPath = path.join(stateDir, "incident-state.json")
    const segmentsDir = path.join(stateDir, "segments")

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

    const buildRequest = (promptCacheKey: string) =>
      new Request("https://api.openai.com/backend-api/codex/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-5.4",
          input: "super private prompt",
          prompt_cache_key: promptCacheKey
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
      sessionKey: "ses_manifest_1"
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
      sessionKey: "ses_manifest_1"
    })
    await logger1.emitFetchAttemptRequest({
      authMode: "codex",
      attempt: 2,
      maxAttempts: 3,
      attemptReasonCode: "retry_switched_account_after_429",
      request: buildRequest("after_one"),
      selectedIdentityKey: "acc_2|user@example.com|team",
      activeIdentityKey: "acc_2|user@example.com|team",
      sessionKey: "ses_manifest_1"
    })

    const staleManifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>
    staleManifest.postRemaining = 2
    await fs.writeFile(manifestPath, `${JSON.stringify(staleManifest, null, 2)}\n`, { mode: 0o600 })

    const incidentsDir = path.join(stateDir, "incidents")
    const [incidentFile] = await fs.readdir(incidentsDir)
    const incidentPath = path.join(incidentsDir, incidentFile ?? "")
    const [segmentFile] = await fs.readdir(segmentsDir)
    const segmentPath = path.join(segmentsDir, segmentFile ?? "")
    const segmentRows = (await fs.readFile(segmentPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    await fs.writeFile(
      segmentPath,
      `${segmentRows
        .filter((row) => typeof row.seq === "number" && row.seq >= 2)
        .map((row) => JSON.stringify(row))
        .join("\n")}\n`,
      { mode: 0o600 }
    )
    await fs.appendFile(incidentPath, '{"seq":999,"event":"partial"')

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
      sessionKey: "ses_manifest_1"
    })

    const incidentRaw = await fs.readFile(incidentPath, "utf8")
    const incidentLines = incidentRaw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(incidentLines.map((line) => line.event)).toEqual([
      "fetch_attempt_request",
      "fetch_attempt_response",
      "fetch_attempt_request",
      "fetch_attempt_response",
      "incident_closed"
    ])
    expect(incidentRaw).not.toContain('"event":"partial"')
    expect(incidentRaw).not.toContain('{"seq":999')

    const summaryRaw = await fs.readFile(filePath, "utf8")
    expect(summaryRaw).toContain('"event":"incident_recovered"')
    await expect(fs.access(manifestPath)).rejects.toThrow()
  })

  it("rebuilds a missing incident prelude from segments when the incident file was left empty", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-shareable-empty-incident-"))
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
          postTriggerEventCount: 1,
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
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-5.4",
          input: "super private prompt",
          prompt_cache_key: promptCacheKey
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
      sessionKey: "ses_empty_incident_1"
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
      sessionKey: "ses_empty_incident_1"
    })

    const incidentsDir = path.join(stateDir, "incidents")
    const [incidentFile] = await fs.readdir(incidentsDir)
    const incidentPath = path.join(incidentsDir, incidentFile ?? "")
    await fs.writeFile(incidentPath, "", { mode: 0o600 })

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
      sessionKey: "ses_empty_incident_1"
    })

    const incidentRaw = await fs.readFile(incidentPath, "utf8")
    const incidentLines = incidentRaw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(incidentLines.map((line) => line.event)).toEqual([
      "fetch_attempt_request",
      "fetch_attempt_response",
      "fetch_attempt_response",
      "incident_closed"
    ])
  })

  it("rebuilds a missing incident file from the segment buffer", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-shareable-missing-file-"))
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
          postTriggerEventCount: 1,
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
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-5.4",
          input: "super private prompt",
          prompt_cache_key: promptCacheKey
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
      sessionKey: "ses_missing_file_1"
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
      sessionKey: "ses_missing_file_1"
    })

    const incidentsDir = path.join(stateDir, "incidents")
    const [incidentFile] = await fs.readdir(incidentsDir)
    const incidentPath = path.join(incidentsDir, incidentFile ?? "")
    await fs.unlink(incidentPath)

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
      sessionKey: "ses_missing_file_1"
    })

    const rebuiltRaw = await fs.readFile(incidentPath, "utf8")
    expect(rebuiltRaw).toContain('"event":"fetch_attempt_request"')
    expect(rebuiltRaw).toContain('"event":"fetch_attempt_response"')
    expect(rebuiltRaw).toContain('"event":"incident_closed"')
  })

  it("recovers post-trigger events from segments when the incident file missed them", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-shareable-post-recover-"))
    const filePath = path.join(root, "shareable-debug.jsonl")
    const stateDir = path.join(root, "shareable-debug-state")
    const manifestPath = path.join(stateDir, "incident-state.json")

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

    const buildRequest = (promptCacheKey: string) =>
      new Request("https://api.openai.com/backend-api/codex/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-5.4",
          input: "super private prompt",
          prompt_cache_key: promptCacheKey
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
      sessionKey: "ses_post_recover_1"
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
      sessionKey: "ses_post_recover_1"
    })
    await logger1.emitFetchAttemptRequest({
      authMode: "codex",
      attempt: 2,
      maxAttempts: 3,
      attemptReasonCode: "retry_switched_account_after_429",
      request: buildRequest("after_one"),
      selectedIdentityKey: "acc_2|user@example.com|team",
      activeIdentityKey: "acc_2|user@example.com|team",
      sessionKey: "ses_post_recover_1"
    })

    const incidentsDir = path.join(stateDir, "incidents")
    const [incidentFile] = await fs.readdir(incidentsDir)
    const incidentPath = path.join(incidentsDir, incidentFile ?? "")
    const incidentRows = (await fs.readFile(incidentPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    await fs.writeFile(
      incidentPath,
      `${incidentRows
        .filter((row) => typeof row.seq === "number" && row.seq <= 2)
        .map((row) => JSON.stringify(row))
        .join("\n")}\n`,
      { mode: 0o600 }
    )

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
      sessionKey: "ses_post_recover_1"
    })

    const recoveredIncidentRaw = await fs.readFile(incidentPath, "utf8")
    const recoveredIncidentLines = recoveredIncidentRaw
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    expect(recoveredIncidentLines.map((line) => line.event)).toEqual([
      "fetch_attempt_request",
      "fetch_attempt_response",
      "fetch_attempt_request",
      "fetch_attempt_response",
      "incident_closed"
    ])
    await expect(fs.access(manifestPath)).rejects.toThrow()
  })

  it("seals the incident incomplete when the pre-trigger window cannot be reconstructed", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-shareable-incomplete-"))
    const filePath = path.join(root, "shareable-debug.jsonl")
    const stateDir = path.join(root, "shareable-debug-state")
    const segmentsDir = path.join(stateDir, "segments")
    const manifestPath = path.join(stateDir, "incident-state.json")

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

    const buildRequest = (promptCacheKey: string) =>
      new Request("https://api.openai.com/backend-api/codex/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-5.4",
          input: "super private prompt",
          prompt_cache_key: promptCacheKey
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
      sessionKey: "ses_incomplete_1"
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
      sessionKey: "ses_incomplete_1"
    })

    const incidentsDir = path.join(stateDir, "incidents")
    const [incidentFile] = await fs.readdir(incidentsDir)
    const incidentPath = path.join(incidentsDir, incidentFile ?? "")
    await fs.writeFile(incidentPath, "", { mode: 0o600 })

    const [segmentFile] = await fs.readdir(segmentsDir)
    await fs.writeFile(path.join(segmentsDir, segmentFile ?? ""), "", { mode: 0o600 })

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
      sessionKey: "ses_incomplete_1"
    })

    const incidentRaw = await fs.readFile(incidentPath, "utf8")
    expect(incidentRaw).toContain('"event":"incident_closed"')
    expect(incidentRaw).toContain('"incomplete":true')

    const summaryRaw = await fs.readFile(filePath, "utf8")
    expect(summaryRaw).toContain('"event":"incident_closed"')
    expect(summaryRaw).toContain('"incomplete":true')
    await expect(fs.access(manifestPath)).rejects.toThrow()
  })

  it("preserves existing incident evidence when sealing an unrecoverable capture", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-shareable-preserve-"))
    const filePath = path.join(root, "shareable-debug.jsonl")
    const stateDir = path.join(root, "shareable-debug-state")
    const segmentsDir = path.join(stateDir, "segments")

    const createLogger = (registerProcessHandlers = false) =>
      createShareableDebugLogger({
        enabled: true,
        filePath,
        stateDir,
        registerProcessHandlers,
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
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-5.4",
          input: "super private prompt",
          prompt_cache_key: promptCacheKey
        })
      })

    const logger1 = createLogger()
    await logger1.emitRotationBegin({
      authMode: "codex",
      rotationStrategy: "sticky",
      activeIdentityKey: "acc_1|user@example.com|pro",
      sessionKey: "ses_preserve_1",
      totalAccounts: 2,
      enabledAccounts: 2
    })
    await logger1.emitFetchAttemptRequest({
      authMode: "codex",
      attempt: 1,
      maxAttempts: 3,
      attemptReasonCode: "initial_attempt",
      request: buildRequest("before"),
      selectedIdentityKey: "acc_1|user@example.com|pro",
      activeIdentityKey: "acc_1|user@example.com|pro",
      sessionKey: "ses_preserve_1"
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
      sessionKey: "ses_preserve_1"
    })
    await logger1.emitFetchAttemptRequest({
      authMode: "codex",
      attempt: 2,
      maxAttempts: 3,
      attemptReasonCode: "retry_switched_account_after_429",
      request: buildRequest("after"),
      selectedIdentityKey: "acc_2|user@example.com|team",
      activeIdentityKey: "acc_2|user@example.com|team",
      sessionKey: "ses_preserve_1"
    })

    const incidentsDir = path.join(stateDir, "incidents")
    const [incidentFile] = await fs.readdir(incidentsDir)
    const incidentPath = path.join(incidentsDir, incidentFile ?? "")
    const incidentRows = (await fs.readFile(incidentPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    await fs.writeFile(
      incidentPath,
      `${incidentRows
        .filter((row) => typeof row.seq === "number" && row.seq >= 2)
        .map((row) => JSON.stringify(row))
        .join("\n")}\n`,
      { mode: 0o600 }
    )

    const [segmentFile] = await fs.readdir(segmentsDir)
    await fs.writeFile(path.join(segmentsDir, segmentFile ?? ""), "", { mode: 0o600 })

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
      sessionKey: "ses_preserve_1"
    })

    const preservedRaw = await fs.readFile(incidentPath, "utf8")
    expect(preservedRaw).toContain('"event":"fetch_attempt_request"')
    expect(preservedRaw).toContain('"event":"fetch_attempt_response"')
    expect(preservedRaw).toContain('"event":"incident_closed"')
    expect(preservedRaw).toContain('"incomplete":true')
  })

  it("captures crash-path incidents with buffered context and leaves them recoverable", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-shareable-crash-"))
    const filePath = path.join(root, "shareable-debug.jsonl")
    const stateDir = path.join(root, "shareable-debug-state")
    const manifestPath = path.join(stateDir, "incident-state.json")

    const createLogger = (registerProcessHandlers = false) =>
      createShareableDebugLogger({
        enabled: true,
        filePath,
        stateDir,
        registerProcessHandlers,
        incidentConfig: {
          preTriggerEventCount: 1,
          postTriggerEventCount: 1,
          segmentMaxBytes: 220,
          rollingBufferMaxBytes: 8_192,
          maxIncidentFiles: 4,
          maxIncidentBytes: 8_192
        }
      })

    const beforeExitListeners = new Set(process.listeners("beforeExit"))
    const uncaughtListeners = new Set(process.listeners("uncaughtExceptionMonitor"))
    const sigintListeners = new Set(process.listeners("SIGINT"))
    const sigtermListeners = new Set(process.listeners("SIGTERM"))
    const extraSignal = process.platform === "win32" ? "SIGBREAK" : "SIGHUP"
    const extraSignalListeners = new Set(process.listeners(extraSignal))

    const logger1 = createLogger(true)
    await logger1.emitRotationBegin({
      authMode: "codex",
      rotationStrategy: "sticky",
      activeIdentityKey: "acc_1|user@example.com|pro",
      sessionKey: "ses_crash_1",
      totalAccounts: 2,
      enabledAccounts: 2
    })

    const addedBeforeExit = process.listeners("beforeExit").filter((listener) => !beforeExitListeners.has(listener))
    const addedUncaught = process
      .listeners("uncaughtExceptionMonitor")
      .filter((listener) => !uncaughtListeners.has(listener))
    const addedSigint = process.listeners("SIGINT").filter((listener) => !sigintListeners.has(listener))
    const addedSigterm = process.listeners("SIGTERM").filter((listener) => !sigtermListeners.has(listener))
    const addedExtraSignal = process.listeners(extraSignal).filter((listener) => !extraSignalListeners.has(listener))

    try {
      expect(addedUncaught).toHaveLength(1)
      ;(addedUncaught[0] as (error: Error) => void)(new Error("boom"))

      const incidentsDir = path.join(stateDir, "incidents")
      const [incidentFile] = await fs.readdir(incidentsDir)
      const incidentPath = path.join(incidentsDir, incidentFile ?? "")
      const crashRaw = await fs.readFile(incidentPath, "utf8")
      expect(crashRaw).toContain('"event":"rotation_begin"')
      expect(crashRaw).toContain('"event":"process_failure"')
      expect(crashRaw).not.toContain('"event":"incident_closed"')
      await fs.access(manifestPath)

      const logger2 = createLogger()
      await logger2.emitRotationCandidateSelected({
        authMode: "codex",
        selectedIdentityKey: "acc_2|user@example.com|team",
        selectedIndex: 1,
        selectedEnabled: true
      })

      const recoveredRaw = await fs.readFile(incidentPath, "utf8")
      expect(recoveredRaw).toContain('"event":"incident_closed"')
      await expect(fs.access(manifestPath)).rejects.toThrow()
    } finally {
      for (const listener of addedBeforeExit) process.removeListener("beforeExit", listener)
      for (const listener of addedUncaught) process.removeListener("uncaughtExceptionMonitor", listener)
      for (const listener of addedSigint) process.removeListener("SIGINT", listener)
      for (const listener of addedSigterm) process.removeListener("SIGTERM", listener)
      for (const listener of addedExtraSignal) process.removeListener(extraSignal, listener)
    }
  })

  it("recovers a trigger from segments when the manifest was never written", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-shareable-manifestless-"))
    const filePath = path.join(root, "shareable-debug.jsonl")
    const stateDir = path.join(root, "shareable-debug-state")
    const manifestPath = path.join(stateDir, "incident-state.json")

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

    const buildRequest = (promptCacheKey: string) =>
      new Request("https://api.openai.com/backend-api/codex/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-5.4",
          input: "super private prompt",
          prompt_cache_key: promptCacheKey
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
      sessionKey: "ses_manifestless_1"
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
      sessionKey: "ses_manifestless_1"
    })

    const incidentsDir = path.join(stateDir, "incidents")
    for (const name of await fs.readdir(incidentsDir)) {
      await fs.unlink(path.join(incidentsDir, name))
    }
    await fs.unlink(manifestPath)

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
      sessionKey: "ses_manifestless_1"
    })

    const recoveredFiles = await fs.readdir(incidentsDir)
    expect(recoveredFiles).toHaveLength(1)
    const recoveredRaw = await fs.readFile(path.join(incidentsDir, recoveredFiles[0] ?? ""), "utf8")
    expect(recoveredRaw).toContain('"event":"fetch_attempt_response"')
    expect(recoveredRaw).toContain('"event":"incident_closed"')
  })

  it("seals manifestless recovery incomplete when the retained prelude is truncated", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-shareable-manifestless-incomplete-"))
    const filePath = path.join(root, "shareable-debug.jsonl")
    const stateDir = path.join(root, "shareable-debug-state")
    const manifestPath = path.join(stateDir, "incident-state.json")
    const segmentsDir = path.join(stateDir, "segments")

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

    const buildRequest = (promptCacheKey: string) =>
      new Request("https://api.openai.com/backend-api/codex/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-5.4",
          input: "super private prompt",
          prompt_cache_key: promptCacheKey
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
      sessionKey: "ses_manifestless_incomplete_1"
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
      sessionKey: "ses_manifestless_incomplete_1"
    })

    const incidentsDir = path.join(stateDir, "incidents")
    for (const name of await fs.readdir(incidentsDir)) {
      await fs.unlink(path.join(incidentsDir, name))
    }
    await fs.unlink(manifestPath)

    const [segmentFile] = await fs.readdir(segmentsDir)
    const segmentPath = path.join(segmentsDir, segmentFile ?? "")
    const segmentRows = (await fs.readFile(segmentPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    await fs.writeFile(
      segmentPath,
      `${segmentRows
        .filter((row) => typeof row.seq === "number" && row.seq >= 2)
        .map((row) => JSON.stringify(row))
        .join("\n")}\n`,
      { mode: 0o600 }
    )

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
      sessionKey: "ses_manifestless_incomplete_1"
    })

    const recoveredFiles = await fs.readdir(incidentsDir)
    expect(recoveredFiles).toHaveLength(1)
    const recoveredRaw = await fs.readFile(path.join(incidentsDir, recoveredFiles[0] ?? ""), "utf8")
    expect(recoveredRaw).toContain('"event":"incident_closed"')
    expect(recoveredRaw).toContain('"incomplete":true')

    const logger3 = createLogger()
    await logger3.emitRotationCandidateSelected({
      authMode: "codex",
      selectedIdentityKey: "acc_2|user@example.com|team",
      selectedIndex: 1,
      selectedEnabled: true
    })

    const recoveredFilesAfterRestart = await fs.readdir(incidentsDir)
    expect(recoveredFilesAfterRestart).toHaveLength(1)
  })
})
