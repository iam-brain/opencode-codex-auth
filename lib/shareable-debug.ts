import { createHmac, randomBytes, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import fsSync from "node:fs"
import path from "node:path"

import {
  enforceOwnerOnlyPermissions,
  isFsErrorCode,
  readJsonFileBestEffort,
  writeJsonFileAtomic,
  writeJsonFileAtomicBestEffort
} from "./cache-io.js"
import type { Logger } from "./logger.js"
import { defaultShareableDebugLogPath } from "./paths.js"
import type { OpenAIAuthMode, RotationStrategy } from "./types.js"

const PROCESS_SECRET = randomBytes(32)

const DEFAULT_SUMMARY_MAX_BYTES = 256 * 1024
const DEFAULT_SUMMARY_MAX_FILES = 2
const DEFAULT_SEGMENT_MAX_BYTES = 16 * 1024
const DEFAULT_ROLLING_BUFFER_MAX_BYTES = 256 * 1024
const DEFAULT_PRE_TRIGGER_EVENT_COUNT = 40
const DEFAULT_POST_TRIGGER_EVENT_COUNT = 20
const DEFAULT_MAX_INCIDENT_FILES = 8
const DEFAULT_MAX_INCIDENT_BYTES = 512 * 1024

type ShareableDebugBaseEvent = {
  authMode: OpenAIAuthMode
}

type ShareableDebugEventRecord = {
  seq: number
  timestamp: string
  event: string
  [key: string]: unknown
}

type TriggerReason = "http_status" | "auth_failure" | "retry_after_429" | "synthetic_fatal_error" | "process_failure"

type IncidentLifecycleReason = "trigger" | "recovered" | "missing_output" | "interrupted"

type IncidentManifest = {
  version: 1
  incidentId: string
  outputFilePath: string
  triggerSeq: number
  triggerEvent: string
  triggerReason: TriggerReason
  preTriggerStartSeq: number
  preTriggerEndSeq: number
  postWindowCount: number
  postRemaining: number
  status: "open"
  createdAt: string
  updatedAt: string
}

type ShareableDebugIncidentConfig = {
  summaryMaxBytes?: number
  summaryMaxFiles?: number
  segmentMaxBytes?: number
  rollingBufferMaxBytes?: number
  preTriggerEventCount?: number
  postTriggerEventCount?: number
  maxIncidentFiles?: number
  maxIncidentBytes?: number
}

export type ShareableDebugLogger = {
  enabled: boolean
  emitRotationBegin: (
    input: ShareableDebugBaseEvent & {
      rotationStrategy: RotationStrategy
      activeIdentityKey?: string
      sessionKey?: string | null
      totalAccounts: number
      enabledAccounts: number
    }
  ) => Promise<void>
  emitRotationDecision: (
    input: ShareableDebugBaseEvent & {
      rotationStrategy: RotationStrategy
      decision: string
      totalCount: number
      disabledCount: number
      cooldownCount: number
      refreshLeaseCount: number
      eligibleCount: number
      attemptedCount?: number
      selectedIdentityKey?: string
      activeIdentityKey?: string
      sessionKey?: string
      attemptKey?: string
      selectedIndex?: number
    }
  ) => Promise<void>
  emitRotationCandidateSelected: (
    input: ShareableDebugBaseEvent & {
      attemptKey?: string
      selectedIdentityKey?: string
      selectedIndex?: number
      selectedEnabled?: boolean
      selectedCooldownUntil?: number | null
      selectedExpires?: number | null
    }
  ) => Promise<void>
  emitFetchAttemptRequest: (
    input: ShareableDebugBaseEvent & {
      attempt: number
      maxAttempts: number
      attemptReasonCode: string
      request: Request
      selectedIdentityKey?: string
      activeIdentityKey?: string
      sessionKey?: string | null
      rotationStrategy?: string
    }
  ) => Promise<void>
  emitFetchAttemptResponse: (
    input: ShareableDebugBaseEvent & {
      attempt: number
      maxAttempts: number
      attemptReasonCode: string
      endpoint?: string
      status: number
      selectedIdentityKey?: string
      activeIdentityKey?: string
      sessionKey?: string | null
      rotationStrategy?: string
    }
  ) => Promise<void>
  emitRetryAfter429: (
    input: ShareableDebugBaseEvent & {
      attempt: number
      maxAttempts: number
      attemptReasonCode: string
      selectedIdentityKey?: string
      activeIdentityKey?: string
      sessionKey?: string | null
      rotationStrategy?: string
    }
  ) => Promise<void>
  emitAuthFailure: (
    input: ShareableDebugBaseEvent & {
      outcome: string
      status: number
      sessionKey?: string | null
      selectedIdentityKey?: string
      activeIdentityKey?: string
      waitMs?: number
    }
  ) => Promise<void>
  emitSyntheticFatalError: (
    input: ShareableDebugBaseEvent & {
      outcome: string
      status: number
      sessionKey?: string | null
      selectedIdentityKey?: string
      activeIdentityKey?: string
      endpoint?: string
    }
  ) => Promise<void>
}

function pseudonym(prefix: string, raw: string | undefined | null): string | undefined {
  const normalized = raw?.trim()
  if (!normalized) return undefined
  const digest = createHmac("sha256", PROCESS_SECRET).update(normalized).digest("hex").slice(0, 8)
  return `${prefix}_${digest}`
}

function normalizeEndpoint(input: string | undefined): string | undefined {
  if (!input) return undefined
  try {
    return new URL(input).pathname || undefined
  } catch {
    return undefined
  }
}

async function extractPromptCacheKey(request: Request): Promise<string | undefined> {
  try {
    const raw = await request.clone().text()
    if (!raw) return undefined

    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const candidate = (parsed as Record<string, unknown>).prompt_cache_key
        return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : undefined
      }
      return undefined
    } catch {
      const params = new URLSearchParams(raw)
      const candidate = params.get("prompt_cache_key")
      return candidate && candidate.trim().length > 0 ? candidate : undefined
    }
  } catch {
    return undefined
  }
}

function createNoopShareableDebugLogger(): ShareableDebugLogger {
  const noop = async () => {}
  return {
    enabled: false,
    emitRotationBegin: noop,
    emitRotationDecision: noop,
    emitRotationCandidateSelected: noop,
    emitFetchAttemptRequest: noop,
    emitFetchAttemptResponse: noop,
    emitRetryAfter429: noop,
    emitAuthFailure: noop,
    emitSyntheticFatalError: noop
  }
}

function defaultStateDirForLogPath(filePath: string): string {
  const parsed = path.parse(filePath)
  return path.join(parsed.dir, `${parsed.name}-state`)
}

function parsePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value))
}

function segmentFileName(startSeq: number): string {
  return `segment-${startSeq.toString().padStart(16, "0")}.jsonl`
}

function incidentFileName(incidentId: string, timestamp: string): string {
  const stamp = timestamp.replaceAll(/[:.]/g, "-")
  return `incident-${stamp}-${incidentId}.jsonl`
}

function sortLexicallyAscending(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function incidentFileReference(filePath: string): string {
  return path.basename(filePath)
}

async function readJsonlRecords(filePath: string): Promise<ShareableDebugEventRecord[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    const records: ShareableDebugEventRecord[] = []

    for (const [index, line] of lines.entries()) {
      try {
        records.push(JSON.parse(line) as ShareableDebugEventRecord)
      } catch (error) {
        if (index === lines.length - 1) {
          break
        }
        throw error
      }
    }

    return records
  } catch (error) {
    if (isFsErrorCode(error, "ENOENT")) {
      return []
    }
    throw error
  }
}

async function lastSeqFromSegment(filePath: string): Promise<number> {
  const rows = await readJsonlRecords(filePath)
  const last = rows.at(-1)
  return typeof last?.seq === "number" ? last.seq : 0
}

async function appendJsonlLine(filePath: string, line: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.appendFile(filePath, line, { mode: 0o600 })
  await enforceOwnerOnlyPermissions(filePath)
}

async function writeJsonlLines(filePath: string, lines: string[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, lines.join(""), { mode: 0o600 })
  await enforceOwnerOnlyPermissions(filePath)
}

function appendJsonlLineSync(filePath: string, line: string): void {
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true })
  fsSync.appendFileSync(filePath, line, { mode: 0o600 })
  try {
    fsSync.chmodSync(filePath, 0o600)
  } catch {
    // best-effort only in crash path
  }
}

async function rotateLogFileIfNeeded(filePath: string, nextLineBytes: number, maxBytes: number, maxFiles: number) {
  const keepFiles = Math.max(1, maxFiles)
  let currentSize = 0
  try {
    currentSize = (await fs.stat(filePath)).size
  } catch (error) {
    if (!isFsErrorCode(error, "ENOENT")) throw error
  }
  if (currentSize === 0 || currentSize + nextLineBytes <= maxBytes) return

  for (let index = keepFiles - 1; index >= 1; index -= 1) {
    const source = index === 1 ? filePath : `${filePath}.${index - 1}`
    const dest = `${filePath}.${index}`
    try {
      await deleteFileIfExists(dest)
      await fs.rename(source, dest)
    } catch (error) {
      if (!isFsErrorCode(error, "ENOENT")) throw error
    }
  }
}

async function deleteFileIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath)
  } catch (error) {
    if (!isFsErrorCode(error, "ENOENT")) throw error
  }
}

function isIncidentManifest(value: unknown): value is IncidentManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === 1 &&
    "incidentId" in value &&
    typeof value.incidentId === "string" &&
    "outputFilePath" in value &&
    typeof value.outputFilePath === "string" &&
    "triggerSeq" in value &&
    typeof value.triggerSeq === "number" &&
    "triggerEvent" in value &&
    typeof value.triggerEvent === "string" &&
    "triggerReason" in value &&
    typeof value.triggerReason === "string" &&
    "preTriggerStartSeq" in value &&
    typeof value.preTriggerStartSeq === "number" &&
    "preTriggerEndSeq" in value &&
    typeof value.preTriggerEndSeq === "number" &&
    "postWindowCount" in value &&
    typeof value.postWindowCount === "number" &&
    "postRemaining" in value &&
    typeof value.postRemaining === "number" &&
    "status" in value &&
    value.status === "open" &&
    "createdAt" in value &&
    typeof value.createdAt === "string" &&
    "updatedAt" in value &&
    typeof value.updatedAt === "string"
  )
}

export function createShareableDebugLogger(input: {
  enabled: boolean
  env?: Record<string, string | undefined>
  filePath?: string
  stateDir?: string
  registerProcessHandlers?: boolean
  incidentConfig?: ShareableDebugIncidentConfig
  log?: Logger
}): ShareableDebugLogger {
  if (!input.enabled) return createNoopShareableDebugLogger()

  const filePath = input.filePath ?? defaultShareableDebugLogPath(input.env)
  const stateDir = input.stateDir ?? defaultStateDirForLogPath(filePath)
  const segmentsDir = path.join(stateDir, "segments")
  const incidentsDir = path.join(stateDir, "incidents")
  const manifestPath = path.join(stateDir, "incident-state.json")

  const summaryMaxBytes = parsePositiveInteger(input.incidentConfig?.summaryMaxBytes, DEFAULT_SUMMARY_MAX_BYTES)
  const summaryMaxFiles = parsePositiveInteger(input.incidentConfig?.summaryMaxFiles, DEFAULT_SUMMARY_MAX_FILES)
  const segmentMaxBytes = parsePositiveInteger(input.incidentConfig?.segmentMaxBytes, DEFAULT_SEGMENT_MAX_BYTES)
  const rollingBufferMaxBytes = parsePositiveInteger(
    input.incidentConfig?.rollingBufferMaxBytes,
    DEFAULT_ROLLING_BUFFER_MAX_BYTES
  )
  const preTriggerEventCount = parsePositiveInteger(
    input.incidentConfig?.preTriggerEventCount,
    DEFAULT_PRE_TRIGGER_EVENT_COUNT
  )
  const postTriggerEventCount = parsePositiveInteger(
    input.incidentConfig?.postTriggerEventCount,
    DEFAULT_POST_TRIGGER_EVENT_COUNT
  )
  const maxIncidentFiles = parsePositiveInteger(input.incidentConfig?.maxIncidentFiles, DEFAULT_MAX_INCIDENT_FILES)
  const maxIncidentBytes = parsePositiveInteger(input.incidentConfig?.maxIncidentBytes, DEFAULT_MAX_INCIDENT_BYTES)

  let nextSeq = 1
  let currentSegmentPath: string | undefined
  let currentSegmentBytes = 0
  let openIncident: IncidentManifest | undefined
  let pendingWrite = Promise.resolve()
  let handlersRegistered = false
  let signalInFlight = false

  const initializeState = async (): Promise<void> => {
    await fs.mkdir(segmentsDir, { recursive: true })
    await fs.mkdir(incidentsDir, { recursive: true })

    const segmentFiles = sortLexicallyAscending(await fs.readdir(segmentsDir).catch(() => []))
    const latestSegment = segmentFiles.at(-1)
    if (latestSegment) {
      currentSegmentPath = path.join(segmentsDir, latestSegment)
      currentSegmentBytes = (await fs.stat(currentSegmentPath)).size
      nextSeq = (await lastSeqFromSegment(currentSegmentPath)) + 1
    }

    const manifest = await readJsonFileBestEffort(manifestPath)
    if (!isIncidentManifest(manifest)) {
      await deleteFileIfExists(manifestPath)
      return
    }

    openIncident = manifest
    try {
      await fs.access(openIncident.outputFilePath)
      await appendSummaryLifecycle("incident_recovered", {
        incidentId: openIncident.incidentId,
        incidentFile: incidentFileReference(openIncident.outputFilePath),
        triggerSeq: openIncident.triggerSeq,
        triggerEvent: openIncident.triggerEvent,
        postRemaining: openIncident.postRemaining
      })
    } catch {
      await sealIncidentIncomplete({
        incident: openIncident,
        reason: "missing_output"
      })
      openIncident = undefined
    }
  }

  const initPromise = initializeState().catch((error) => {
    input.log?.warn("shareable debug initialization failed", {
      error: error instanceof Error ? error.message : String(error)
    })
  })

  const runQueued = (work: () => Promise<void>): Promise<void> => {
    pendingWrite = pendingWrite
      .then(() => initPromise)
      .then(work)
      .catch((error) => {
        input.log?.warn("shareable debug write failed", {
          error: error instanceof Error ? error.message : String(error)
        })
      })
    return pendingWrite
  }

  const writeManifest = async (manifest: IncidentManifest): Promise<void> => {
    await writeJsonFileAtomic(manifestPath, manifest)
  }

  const writeManifestBestEffort = async (manifest: IncidentManifest): Promise<void> => {
    await writeJsonFileAtomicBestEffort(manifestPath, manifest)
  }

  const appendSummaryLine = async (line: string): Promise<void> => {
    await rotateLogFileIfNeeded(filePath, Buffer.byteLength(line), summaryMaxBytes, summaryMaxFiles)
    await appendJsonlLine(filePath, line)
  }

  const appendSummaryLifecycle = async (event: string, payload: Record<string, unknown>): Promise<void> => {
    const line = `${JSON.stringify({ timestamp: new Date().toISOString(), event, ...payload })}\n`
    await appendSummaryLine(line)
  }

  const appendSummaryLineSync = (line: string): void => {
    try {
      const existingSize = fsSync.existsSync(filePath) ? fsSync.statSync(filePath).size : 0
      if (existingSize > 0 && existingSize + Buffer.byteLength(line) > summaryMaxBytes) {
        for (let index = summaryMaxFiles - 1; index >= 1; index -= 1) {
          const source = index === 1 ? filePath : `${filePath}.${index - 1}`
          const dest = `${filePath}.${index}`
          if (fsSync.existsSync(source)) {
            if (fsSync.existsSync(dest)) {
              fsSync.unlinkSync(dest)
            }
            fsSync.renameSync(source, dest)
          }
        }
      }
      appendJsonlLineSync(filePath, line)
    } catch {
      // best-effort only in crash path
    }
  }

  const ensureSegmentForLine = async (lineBytes: number, seq: number): Promise<void> => {
    if (!currentSegmentPath || currentSegmentBytes + lineBytes > segmentMaxBytes) {
      currentSegmentPath = path.join(segmentsDir, segmentFileName(seq))
      currentSegmentBytes = 0
    }
  }

  const pruneSegments = async (): Promise<void> => {
    const files = sortLexicallyAscending(await fs.readdir(segmentsDir))
    let totalBytes = 0
    const entries: Array<{ name: string; filePath: string; size: number }> = []
    for (const name of files) {
      const filePath = path.join(segmentsDir, name)
      const stat = await fs.stat(filePath)
      entries.push({ name, filePath, size: stat.size })
      totalBytes += stat.size
    }

    for (const entry of entries) {
      if (totalBytes <= rollingBufferMaxBytes) break
      if (entry.filePath === currentSegmentPath) continue
      await deleteFileIfExists(entry.filePath)
      totalBytes -= entry.size
    }
  }

  const pruneIncidents = async (): Promise<void> => {
    const incidentFiles = sortLexicallyAscending(await fs.readdir(incidentsDir).catch(() => []))
    const entries: Array<{ filePath: string; name: string; size: number }> = []
    let totalBytes = 0
    for (const name of incidentFiles) {
      const filePath = path.join(incidentsDir, name)
      const stat = await fs.stat(filePath)
      entries.push({ filePath, name, size: stat.size })
      totalBytes += stat.size
    }

    for (const entry of entries) {
      if (entries.length <= maxIncidentFiles && totalBytes <= maxIncidentBytes) break
      if (entry.filePath === openIncident?.outputFilePath) continue
      await deleteFileIfExists(entry.filePath)
      totalBytes -= entry.size
      const index = entries.findIndex((candidate) => candidate.filePath === entry.filePath)
      if (index >= 0) {
        entries.splice(index, 1)
      }
    }
  }

  const appendToSegment = async (record: ShareableDebugEventRecord): Promise<void> => {
    const line = `${JSON.stringify(record)}\n`
    const lineBytes = Buffer.byteLength(line)
    await ensureSegmentForLine(lineBytes, record.seq)
    if (!currentSegmentPath) {
      throw new Error("shareable_debug_missing_segment_path")
    }
    await appendJsonlLine(currentSegmentPath, line)
    currentSegmentBytes += lineBytes
    await pruneSegments()
  }

  const appendToSegmentSync = (record: ShareableDebugEventRecord): void => {
    const line = `${JSON.stringify(record)}\n`
    const lineBytes = Buffer.byteLength(line)
    if (!currentSegmentPath || currentSegmentBytes + lineBytes > segmentMaxBytes) {
      currentSegmentPath = path.join(segmentsDir, segmentFileName(record.seq))
      currentSegmentBytes = 0
    }
    appendJsonlLineSync(currentSegmentPath, line)
    currentSegmentBytes += lineBytes
  }

  const readEventsInRange = async (startSeq: number, endSeq: number): Promise<ShareableDebugEventRecord[]> => {
    const files = sortLexicallyAscending(await fs.readdir(segmentsDir))
    const events: ShareableDebugEventRecord[] = []
    for (const name of files) {
      const rows = await readJsonlRecords(path.join(segmentsDir, name))
      for (const row of rows) {
        if (typeof row.seq !== "number") continue
        if (row.seq < startSeq || row.seq > endSeq) continue
        events.push(row)
      }
    }
    return events.sort((left, right) => left.seq - right.seq)
  }

  const appendIncidentLine = async (incident: IncidentManifest, record: ShareableDebugEventRecord): Promise<void> => {
    await appendJsonlLine(incident.outputFilePath, `${JSON.stringify(record)}\n`)
  }

  const appendIncidentLifecycle = async (
    incident: IncidentManifest,
    event: string,
    payload: Record<string, unknown>
  ): Promise<void> => {
    await appendJsonlLine(
      incident.outputFilePath,
      `${JSON.stringify({
        seq: nextSeq++,
        timestamp: new Date().toISOString(),
        event,
        incidentId: incident.incidentId,
        ...payload
      })}\n`
    )
  }

  const appendIncidentLifecycleSync = (
    incident: IncidentManifest,
    event: string,
    payload: Record<string, unknown>
  ): void => {
    appendJsonlLineSync(
      incident.outputFilePath,
      `${JSON.stringify({
        seq: nextSeq++,
        timestamp: new Date().toISOString(),
        event,
        incidentId: incident.incidentId,
        ...payload
      })}\n`
    )
  }

  const closeIncident = async (incident: IncidentManifest, reason: IncidentLifecycleReason): Promise<void> => {
    await appendIncidentLifecycle(incident, "incident_closed", {
      reason,
      triggerSeq: incident.triggerSeq,
      triggerEvent: incident.triggerEvent,
      incomplete: false
    })
    await appendSummaryLifecycle("incident_closed", {
      incidentId: incident.incidentId,
      incidentFile: incidentFileReference(incident.outputFilePath),
      triggerSeq: incident.triggerSeq,
      triggerEvent: incident.triggerEvent,
      reason
    })
    await deleteFileIfExists(manifestPath)
    openIncident = undefined
    await pruneIncidents()
  }

  const sealIncidentIncomplete = async (inputState: {
    incident: IncidentManifest
    reason: IncidentLifecycleReason
  }): Promise<void> => {
    await writeJsonlLines(inputState.incident.outputFilePath, []).catch(() => {
      // best-effort file creation
    })
    await appendIncidentLifecycle(inputState.incident, "incident_closed", {
      reason: inputState.reason,
      triggerSeq: inputState.incident.triggerSeq,
      triggerEvent: inputState.incident.triggerEvent,
      incomplete: true
    })
    await appendSummaryLifecycle("incident_closed", {
      incidentId: inputState.incident.incidentId,
      incidentFile: incidentFileReference(inputState.incident.outputFilePath),
      triggerSeq: inputState.incident.triggerSeq,
      triggerEvent: inputState.incident.triggerEvent,
      reason: inputState.reason,
      incomplete: true
    })
    await deleteFileIfExists(manifestPath)
  }

  const openIncidentCapture = async (
    record: ShareableDebugEventRecord,
    triggerReason: TriggerReason
  ): Promise<void> => {
    if (openIncident) return
    const incidentId = randomUUID()
    const timestamp = new Date().toISOString()
    const preTriggerStartSeq = Math.max(1, record.seq - preTriggerEventCount)
    const incident: IncidentManifest = {
      version: 1,
      incidentId,
      outputFilePath: path.join(incidentsDir, incidentFileName(incidentId, timestamp)),
      triggerSeq: record.seq,
      triggerEvent: record.event,
      triggerReason,
      preTriggerStartSeq,
      preTriggerEndSeq: record.seq,
      postWindowCount: postTriggerEventCount,
      postRemaining: postTriggerEventCount,
      status: "open",
      createdAt: timestamp,
      updatedAt: timestamp
    }

    await writeManifest(incident)
    const preTriggerEvents = await readEventsInRange(preTriggerStartSeq, record.seq)
    await writeJsonlLines(
      incident.outputFilePath,
      preTriggerEvents.map((entry) => `${JSON.stringify(entry)}\n`)
    )
    await appendSummaryLifecycle("incident_opened", {
      incidentId,
      incidentFile: incidentFileReference(incident.outputFilePath),
      triggerSeq: record.seq,
      triggerEvent: record.event,
      triggerReason
    })

    if (incident.postRemaining <= 0) {
      await closeIncident(incident, "trigger")
      return
    }
    openIncident = incident
    await pruneIncidents()
  }

  const appendToOpenIncident = async (record: ShareableDebugEventRecord): Promise<void> => {
    if (!openIncident || record.seq <= openIncident.triggerSeq) return
    await appendIncidentLine(openIncident, record)
    openIncident = {
      ...openIncident,
      postRemaining: Math.max(0, openIncident.postRemaining - 1),
      updatedAt: new Date().toISOString()
    }
    if (openIncident.postRemaining <= 0) {
      await closeIncident(openIncident, "trigger")
      return
    }
    await writeManifestBestEffort(openIncident)
  }

  const triggerReasonFor = (record: ShareableDebugEventRecord): TriggerReason | undefined => {
    if (record.event === "auth_failure") return "auth_failure"
    if (record.event === "retry_after_429") return "retry_after_429"
    if (record.event === "synthetic_fatal_error") return "synthetic_fatal_error"
    if (record.event === "process_failure") return "process_failure"
    if (record.event === "fetch_attempt_response") {
      const status = typeof record.status === "number" ? record.status : undefined
      if (status === 401 || status === 403 || status === 429) {
        return "http_status"
      }
    }
    return undefined
  }

  const appendRecord = async (record: ShareableDebugEventRecord): Promise<void> => {
    await appendToSegment(record)
    const triggerReason = triggerReasonFor(record)
    if (triggerReason && !openIncident) {
      await openIncidentCapture(record, triggerReason)
    } else {
      await appendToOpenIncident(record)
    }
    await appendSummaryLine(`${JSON.stringify(record)}\n`)
  }

  const buildRecord = (event: string, payload: Record<string, unknown>): ShareableDebugEventRecord => ({
    seq: nextSeq++,
    timestamp: new Date().toISOString(),
    event,
    ...payload
  })

  const emitEvent = async (event: string, payload: Record<string, unknown>): Promise<void> => {
    await runQueued(async () => {
      const record = buildRecord(event, payload)
      await appendRecord(record)
    })
  }

  const captureProcessFailureSync = (event: string, payload: Record<string, unknown>): void => {
    try {
      const record = buildRecord(event, payload)
      appendToSegmentSync(record)
      const triggerReason = triggerReasonFor(record)
      if (triggerReason && !openIncident) {
        const incidentId = randomUUID()
        const timestamp = new Date().toISOString()
        const incident: IncidentManifest = {
          version: 1,
          incidentId,
          outputFilePath: path.join(incidentsDir, incidentFileName(incidentId, timestamp)),
          triggerSeq: record.seq,
          triggerEvent: record.event,
          triggerReason,
          preTriggerStartSeq: Math.max(1, record.seq - preTriggerEventCount),
          preTriggerEndSeq: record.seq,
          postWindowCount: postTriggerEventCount,
          postRemaining: postTriggerEventCount,
          status: "open",
          createdAt: timestamp,
          updatedAt: timestamp
        }
        fsSync.mkdirSync(path.dirname(manifestPath), { recursive: true })
        fsSync.writeFileSync(manifestPath, `${JSON.stringify(incident, null, 2)}\n`, { mode: 0o600 })
        appendJsonlLineSync(
          incident.outputFilePath,
          `${JSON.stringify({
            ...record
          })}\n`
        )
        appendIncidentLifecycleSync(incident, "incident_closed", {
          reason: "interrupted",
          triggerSeq: incident.triggerSeq,
          triggerEvent: incident.triggerEvent,
          incomplete: true
        })
        fsSync.unlinkSync(manifestPath)
        appendSummaryLineSync(
          `${JSON.stringify({
            timestamp: new Date().toISOString(),
            event: "incident_closed",
            incidentId,
            incidentFile: incidentFileReference(incident.outputFilePath),
            triggerSeq: incident.triggerSeq,
            triggerEvent: incident.triggerEvent,
            reason: "interrupted",
            incomplete: true
          })}\n`
        )
      } else if (openIncident && record.seq > openIncident.triggerSeq) {
        appendJsonlLineSync(openIncident.outputFilePath, `${JSON.stringify(record)}\n`)
      }
      appendSummaryLineSync(`${JSON.stringify(record)}\n`)
    } catch {
      // best-effort only in crash path
    }
  }

  const flushPending = async (): Promise<void> => {
    await pendingWrite
  }

  const installProcessHandlers = (): void => {
    if (input.registerProcessHandlers === false || handlersRegistered) return
    handlersRegistered = true

    const handleSignal = (signal: NodeJS.Signals) => {
      if (signalInFlight) return
      signalInFlight = true
      captureProcessFailureSync("process_failure", {
        authMode: "codex",
        outcome: signal.toLowerCase(),
        status: 499
      })
      const signalHandler = signalHandlers[signal]
      if (signalHandler) {
        process.removeListener(signal, signalHandler)
      }
      try {
        process.kill(process.pid, signal)
      } catch {
        // best-effort only
      }
    }

    const beforeExitHandler = () => {
      void flushPending()
    }
    const uncaughtExceptionMonitorHandler = (error: Error) => {
      captureProcessFailureSync("process_failure", {
        authMode: "codex",
        outcome: "uncaught_exception",
        status: 500,
        errorName: error.name
      })
    }

    const signalHandlers: Partial<Record<NodeJS.Signals, () => void>> = {
      SIGINT: () => handleSignal("SIGINT"),
      SIGTERM: () => handleSignal("SIGTERM"),
      SIGHUP: () => handleSignal("SIGHUP"),
      SIGBREAK: () => handleSignal("SIGBREAK")
    }

    process.on("beforeExit", beforeExitHandler)
    process.on("uncaughtExceptionMonitor", uncaughtExceptionMonitorHandler)
    process.on("SIGINT", signalHandlers.SIGINT ?? (() => {}))
    process.on("SIGTERM", signalHandlers.SIGTERM ?? (() => {}))
    if (process.platform === "win32") {
      process.on("SIGBREAK", signalHandlers.SIGBREAK ?? (() => {}))
    } else {
      process.on("SIGHUP", signalHandlers.SIGHUP ?? (() => {}))
    }
  }

  installProcessHandlers()

  return {
    enabled: true,
    async emitRotationBegin(event) {
      await emitEvent("rotation_begin", {
        authMode: event.authMode,
        rotationStrategy: event.rotationStrategy,
        totalAccounts: event.totalAccounts,
        enabledAccounts: event.enabledAccounts,
        activeIdentity: pseudonym("ident", event.activeIdentityKey),
        session: pseudonym("sess", event.sessionKey)
      })
    },
    async emitRotationDecision(event) {
      await emitEvent("rotation_decision", {
        authMode: event.authMode,
        rotationStrategy: event.rotationStrategy,
        decision: event.decision,
        totalCount: event.totalCount,
        disabledCount: event.disabledCount,
        cooldownCount: event.cooldownCount,
        refreshLeaseCount: event.refreshLeaseCount,
        eligibleCount: event.eligibleCount,
        attemptedCount: event.attemptedCount,
        selectedIndex: event.selectedIndex,
        selectedIdentity: pseudonym("ident", event.selectedIdentityKey),
        activeIdentity: pseudonym("ident", event.activeIdentityKey),
        session: pseudonym("sess", event.sessionKey),
        attempt: pseudonym("attempt", event.attemptKey)
      })
    },
    async emitRotationCandidateSelected(event) {
      await emitEvent("rotation_candidate_selected", {
        authMode: event.authMode,
        selectedIndex: event.selectedIndex,
        selectedEnabled: event.selectedEnabled,
        selectedCooldownUntil: event.selectedCooldownUntil,
        selectedExpires: event.selectedExpires,
        selectedIdentity: pseudonym("ident", event.selectedIdentityKey),
        attempt: pseudonym("attempt", event.attemptKey)
      })
    },
    async emitFetchAttemptRequest(event) {
      await emitEvent("fetch_attempt_request", {
        authMode: event.authMode,
        rotationStrategy: event.rotationStrategy,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        attemptReasonCode: event.attemptReasonCode,
        method: event.request.method.toUpperCase(),
        endpoint: normalizeEndpoint(event.request.url),
        selectedIdentity: pseudonym("ident", event.selectedIdentityKey),
        activeIdentity: pseudonym("ident", event.activeIdentityKey),
        session: pseudonym("sess", event.sessionKey),
        promptCacheKey: pseudonym("pck", await extractPromptCacheKey(event.request))
      })
    },
    async emitFetchAttemptResponse(event) {
      await emitEvent("fetch_attempt_response", {
        authMode: event.authMode,
        rotationStrategy: event.rotationStrategy,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        attemptReasonCode: event.attemptReasonCode,
        endpoint: normalizeEndpoint(event.endpoint),
        status: event.status,
        selectedIdentity: pseudonym("ident", event.selectedIdentityKey),
        activeIdentity: pseudonym("ident", event.activeIdentityKey),
        session: pseudonym("sess", event.sessionKey)
      })
    },
    async emitRetryAfter429(event) {
      await emitEvent("retry_after_429", {
        authMode: event.authMode,
        rotationStrategy: event.rotationStrategy,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        attemptReasonCode: event.attemptReasonCode,
        selectedIdentity: pseudonym("ident", event.selectedIdentityKey),
        activeIdentity: pseudonym("ident", event.activeIdentityKey),
        session: pseudonym("sess", event.sessionKey)
      })
    },
    async emitAuthFailure(event) {
      await emitEvent("auth_failure", {
        authMode: event.authMode,
        outcome: event.outcome,
        status: event.status,
        waitMs: event.waitMs,
        selectedIdentity: pseudonym("ident", event.selectedIdentityKey),
        activeIdentity: pseudonym("ident", event.activeIdentityKey),
        session: pseudonym("sess", event.sessionKey)
      })
    },
    async emitSyntheticFatalError(event) {
      await emitEvent("synthetic_fatal_error", {
        authMode: event.authMode,
        outcome: event.outcome,
        status: event.status,
        endpoint: normalizeEndpoint(event.endpoint),
        selectedIdentity: pseudonym("ident", event.selectedIdentityKey),
        activeIdentity: pseudonym("ident", event.activeIdentityKey),
        session: pseudonym("sess", event.sessionKey)
      })
    }
  }
}
