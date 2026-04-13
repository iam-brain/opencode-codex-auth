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

type JsonlReadResult = {
  records: ShareableDebugEventRecord[]
  hadTruncatedTail: boolean
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

type ManifestlessRecoveryMarker = {
  version: 1
  triggerSeq: number
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

function contiguousWindow(
  rows: ShareableDebugEventRecord[],
  startSeq: number,
  maxCount: number
): {
  rows: ShareableDebugEventRecord[]
  hasGapAfterPrefix: boolean
} {
  const deduped = Array.from(new Map(rows.map((row) => [row.seq, row] as const)).values()).sort(
    (left, right) => left.seq - right.seq
  )
  const window: ShareableDebugEventRecord[] = []
  let expectedSeq = startSeq

  for (const row of deduped) {
    if (window.length >= maxCount) break
    if (row.seq < expectedSeq) continue
    if (row.seq > expectedSeq) {
      return {
        rows: window,
        hasGapAfterPrefix: true
      }
    }
    window.push(row)
    expectedSeq += 1
  }

  return {
    rows: window,
    hasGapAfterPrefix: false
  }
}

function parseSegmentStartSeq(filePath: string): number | undefined {
  const match = /^segment-(\d+)\.jsonl$/u.exec(path.basename(filePath))
  if (!match) return undefined
  const value = Number.parseInt(match[1] ?? "", 10)
  return Number.isFinite(value) && value >= 1 ? value : undefined
}

async function readJsonlFile(filePath: string): Promise<JsonlReadResult> {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    const records: ShareableDebugEventRecord[] = []
    let hadTruncatedTail = false

    for (const [index, line] of lines.entries()) {
      try {
        records.push(JSON.parse(line) as ShareableDebugEventRecord)
      } catch (error) {
        if (index === lines.length - 1) {
          hadTruncatedTail = true
          break
        }
        throw error
      }
    }

    return {
      records,
      hadTruncatedTail
    }
  } catch (error) {
    if (isFsErrorCode(error, "ENOENT")) {
      return {
        records: [],
        hadTruncatedTail: false
      }
    }
    throw error
  }
}

function readJsonlFileSync(filePath: string): JsonlReadResult {
  try {
    const raw = fsSync.readFileSync(filePath, "utf8")
    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    const records: ShareableDebugEventRecord[] = []
    let hadTruncatedTail = false

    for (const [index, line] of lines.entries()) {
      try {
        records.push(JSON.parse(line) as ShareableDebugEventRecord)
      } catch (error) {
        if (index === lines.length - 1) {
          hadTruncatedTail = true
          break
        }
        throw error
      }
    }

    return {
      records,
      hadTruncatedTail
    }
  } catch (error) {
    if (isFsErrorCode(error, "ENOENT")) {
      return {
        records: [],
        hadTruncatedTail: false
      }
    }
    throw error
  }
}

async function readJsonlRecords(filePath: string): Promise<ShareableDebugEventRecord[]> {
  return (await readJsonlFile(filePath)).records
}

function readJsonlRecordsSync(filePath: string): ShareableDebugEventRecord[] {
  return readJsonlFileSync(filePath).records
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

function writeJsonlLinesSync(filePath: string, lines: string[]): void {
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true })
  fsSync.writeFileSync(filePath, lines.join(""), { mode: 0o600 })
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

function isManifestlessRecoveryMarker(value: unknown): value is ManifestlessRecoveryMarker {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === 1 &&
    "triggerSeq" in value &&
    typeof value.triggerSeq === "number"
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
  const manifestlessRecoveryPath = path.join(stateDir, "manifestless-recovery.json")

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
  let initPromise = Promise.resolve()
  let handlersRegistered = false
  let signalInFlight = false

  const sanitizeJsonlTail = async (targetPath: string): Promise<ShareableDebugEventRecord[]> => {
    const result = await readJsonlFile(targetPath)
    if (result.hadTruncatedTail) {
      await writeJsonlLines(
        targetPath,
        result.records.map((record) => `${JSON.stringify(record)}\n`)
      )
    }
    return result.records
  }

  const appendSummaryLifecycleSync = (event: string, payload: Record<string, unknown>): void => {
    appendSummaryLineSync(`${JSON.stringify({ timestamp: new Date().toISOString(), event, ...payload })}\n`)
  }

  const reconcileIncidentFile = async (incident: IncidentManifest): Promise<IncidentManifest | undefined> => {
    let incidentRecords: ShareableDebugEventRecord[]
    try {
      incidentRecords = await sanitizeJsonlTail(incident.outputFilePath)
    } catch (error) {
      if (isFsErrorCode(error, "ENOENT")) {
        incidentRecords = []
      } else {
        await sealIncidentIncomplete({
          incident,
          reason: "interrupted"
        })
        return undefined
      }
    }

    const baseRowsFromSegments = await readEventsInRange(incident.preTriggerStartSeq, incident.preTriggerEndSeq)
    const baseRowsFromIncident = incidentRecords.filter(
      (row) => typeof row.seq === "number" && row.seq >= incident.preTriggerStartSeq && row.seq <= incident.triggerSeq
    )
    const expectedBaseCount = incident.triggerSeq - incident.preTriggerStartSeq + 1
    const baseWindow = contiguousWindow(
      [...baseRowsFromIncident, ...baseRowsFromSegments],
      incident.preTriggerStartSeq,
      expectedBaseCount
    )

    if (
      baseWindow.hasGapAfterPrefix ||
      baseWindow.rows.length !== expectedBaseCount ||
      !baseWindow.rows.some((row) => row.seq === incident.triggerSeq && row.event === incident.triggerEvent)
    ) {
      await sealIncidentIncomplete({
        incident,
        reason: "interrupted"
      })
      return undefined
    }

    const closedRow = incidentRecords.find(
      (row) => row.event === "incident_closed" && row.incidentId === incident.incidentId
    )
    if (closedRow) {
      await deleteFileIfExists(manifestPath)
      return undefined
    }

    const postRowsFromSegments = await readEventsInRange(
      incident.triggerSeq + 1,
      incident.triggerSeq + incident.postWindowCount
    )
    const recoveredPostWindow = contiguousWindow(
      [
        ...incidentRecords.filter(
          (row) => typeof row.seq === "number" && row.seq > incident.triggerSeq && row.event !== "incident_closed"
        ),
        ...postRowsFromSegments
      ],
      incident.triggerSeq + 1,
      incident.postWindowCount
    )
    if (recoveredPostWindow.hasGapAfterPrefix) {
      await sealIncidentIncomplete({
        incident,
        reason: "interrupted"
      })
      return undefined
    }
    const recoveredPostRows = recoveredPostWindow.rows

    await writeJsonlLines(
      incident.outputFilePath,
      [...baseWindow.rows, ...recoveredPostRows].map((row) => `${JSON.stringify(row)}\n`)
    )

    const postRemaining = Math.max(0, incident.postWindowCount - recoveredPostRows.length)
    const recoveredIncident: IncidentManifest = {
      ...incident,
      postRemaining,
      updatedAt: new Date().toISOString()
    }

    if (recoveredIncident.postRemaining <= 0) {
      await closeIncident(recoveredIncident, "recovered")
      return undefined
    }

    await writeManifest(recoveredIncident)
    await appendSummaryLifecycle("incident_recovered", {
      incidentId: recoveredIncident.incidentId,
      incidentFile: incidentFileReference(recoveredIncident.outputFilePath),
      triggerSeq: recoveredIncident.triggerSeq,
      triggerEvent: recoveredIncident.triggerEvent,
      postRemaining: recoveredIncident.postRemaining
    })
    return recoveredIncident
  }

  const initializeState = async (): Promise<void> => {
    await fs.mkdir(segmentsDir, { recursive: true })
    await fs.mkdir(incidentsDir, { recursive: true })

    const segmentFiles = sortLexicallyAscending(await fs.readdir(segmentsDir).catch(() => []))
    const latestSegment = segmentFiles.at(-1)
    let latestSegmentRecord: ShareableDebugEventRecord | undefined
    if (latestSegment) {
      currentSegmentPath = path.join(segmentsDir, latestSegment)
      const latestSegmentRows = await sanitizeJsonlTail(currentSegmentPath)
      currentSegmentBytes = (await fs.stat(currentSegmentPath)).size
      const segmentStartSeq = parseSegmentStartSeq(currentSegmentPath) ?? 1
      nextSeq = Math.max(segmentStartSeq, (await lastSeqFromSegment(currentSegmentPath)) + 1)
      latestSegmentRecord = latestSegmentRows.at(-1)
    }

    const manifest = await readJsonFileBestEffort(manifestPath)
    const manifestlessRecovery = await readJsonFileBestEffort(manifestlessRecoveryPath)
    if (
      isManifestlessRecoveryMarker(manifestlessRecovery) &&
      manifestlessRecovery.triggerSeq !== latestSegmentRecord?.seq
    ) {
      await deleteFileIfExists(manifestlessRecoveryPath)
    }
    if (!isIncidentManifest(manifest)) {
      await deleteFileIfExists(manifestPath)
      const triggerReason = latestSegmentRecord ? triggerReasonFor(latestSegmentRecord) : undefined
      if (
        latestSegmentRecord &&
        triggerReason &&
        (!isManifestlessRecoveryMarker(manifestlessRecovery) ||
          manifestlessRecovery.triggerSeq !== latestSegmentRecord.seq)
      ) {
        const incident = createIncidentManifest(latestSegmentRecord, triggerReason)
        const preTriggerEvents = await readEventsInRange(incident.preTriggerStartSeq, incident.preTriggerEndSeq)
        const expectedBaseCount = incident.triggerSeq - incident.preTriggerStartSeq + 1
        const baseWindow = contiguousWindow(preTriggerEvents, incident.preTriggerStartSeq, expectedBaseCount)

        await writeJsonlLines(
          incident.outputFilePath,
          baseWindow.rows.map((entry) => `${JSON.stringify(entry)}\n`)
        )
        if (baseWindow.hasGapAfterPrefix || baseWindow.rows.length !== expectedBaseCount) {
          await writeJsonFileAtomic(manifestlessRecoveryPath, {
            version: 1,
            triggerSeq: latestSegmentRecord.seq
          })
          await sealIncidentIncomplete({
            incident,
            reason: "interrupted"
          })
          return
        }

        await writeManifest(incident)
        await deleteFileIfExists(manifestlessRecoveryPath)
        await appendSummaryLifecycle("incident_recovered", {
          incidentId: incident.incidentId,
          incidentFile: incidentFileReference(incident.outputFilePath),
          triggerSeq: incident.triggerSeq,
          triggerEvent: incident.triggerEvent,
          postRemaining: incident.postRemaining
        })
        openIncident = incident
        await pruneIncidents()
      }
      return
    }

    openIncident = await reconcileIncidentFile(manifest)
  }

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

  const readEventsInRangeSync = (startSeq: number, endSeq: number): ShareableDebugEventRecord[] => {
    const files = sortLexicallyAscending(fsSync.readdirSync(segmentsDir, "utf8"))
    const events: ShareableDebugEventRecord[] = []
    for (const name of files) {
      const rows = readJsonlRecordsSync(path.join(segmentsDir, name))
      for (const row of rows) {
        if (typeof row.seq !== "number") continue
        if (row.seq < startSeq || row.seq > endSeq) continue
        events.push(row)
      }
    }
    return events.sort((left, right) => left.seq - right.seq)
  }

  const createIncidentManifest = (
    record: ShareableDebugEventRecord,
    triggerReason: TriggerReason
  ): IncidentManifest => {
    const incidentId = randomUUID()
    const timestamp = new Date().toISOString()
    return {
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
    try {
      await sanitizeJsonlTail(inputState.incident.outputFilePath)
    } catch (error) {
      if (isFsErrorCode(error, "ENOENT")) {
        await writeJsonlLines(inputState.incident.outputFilePath, [])
      }
    }
    await writeJsonFileAtomic(manifestlessRecoveryPath, {
      version: 1,
      triggerSeq: inputState.incident.triggerSeq
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

  const writeManifestSync = (incident: IncidentManifest): void => {
    fsSync.mkdirSync(path.dirname(manifestPath), { recursive: true })
    fsSync.writeFileSync(manifestPath, `${JSON.stringify(incident, null, 2)}\n`, { mode: 0o600 })
    try {
      fsSync.chmodSync(manifestPath, 0o600)
    } catch {
      // best-effort only in crash path
    }
  }

  const sealIncidentIncompleteSync = (incident: IncidentManifest, reason: IncidentLifecycleReason): void => {
    try {
      fsSync.mkdirSync(path.dirname(manifestlessRecoveryPath), { recursive: true })
      fsSync.writeFileSync(
        manifestlessRecoveryPath,
        `${JSON.stringify({ version: 1, triggerSeq: incident.triggerSeq }, null, 2)}\n`,
        { mode: 0o600 }
      )
      fsSync.chmodSync(manifestlessRecoveryPath, 0o600)
    } catch {
      // best-effort only in crash path
    }
    appendIncidentLifecycleSync(incident, "incident_closed", {
      reason,
      triggerSeq: incident.triggerSeq,
      triggerEvent: incident.triggerEvent,
      incomplete: true
    })
    appendSummaryLifecycleSync("incident_closed", {
      incidentId: incident.incidentId,
      incidentFile: incidentFileReference(incident.outputFilePath),
      triggerSeq: incident.triggerSeq,
      triggerEvent: incident.triggerEvent,
      reason,
      incomplete: true
    })
    try {
      fsSync.unlinkSync(manifestPath)
    } catch (error) {
      if (!isFsErrorCode(error, "ENOENT")) throw error
    }
  }

  const openIncidentCaptureSync = (
    record: ShareableDebugEventRecord,
    triggerReason: TriggerReason
  ): IncidentManifest => {
    const incident = createIncidentManifest(record, triggerReason)
    writeManifestSync(incident)
    const preTriggerEvents = readEventsInRangeSync(incident.preTriggerStartSeq, record.seq)
    const expectedBaseCount = incident.triggerSeq - incident.preTriggerStartSeq + 1
    const baseWindow = contiguousWindow(preTriggerEvents, incident.preTriggerStartSeq, expectedBaseCount)
    writeJsonlLinesSync(
      incident.outputFilePath,
      baseWindow.rows.map((entry) => `${JSON.stringify(entry)}\n`)
    )
    if (baseWindow.hasGapAfterPrefix || baseWindow.rows.length !== expectedBaseCount) {
      sealIncidentIncompleteSync(incident, "interrupted")
      return incident
    }
    try {
      fsSync.unlinkSync(manifestlessRecoveryPath)
    } catch (error) {
      if (!isFsErrorCode(error, "ENOENT")) throw error
    }
    appendSummaryLifecycleSync("incident_opened", {
      incidentId: incident.incidentId,
      incidentFile: incidentFileReference(incident.outputFilePath),
      triggerSeq: record.seq,
      triggerEvent: record.event,
      triggerReason
    })
    return incident
  }

  initPromise = initializeState().catch((error) => {
    input.log?.warn("shareable debug initialization failed", {
      error: error instanceof Error ? error.message : String(error)
    })
  })

  const openIncidentCapture = async (
    record: ShareableDebugEventRecord,
    triggerReason: TriggerReason
  ): Promise<void> => {
    if (openIncident) return
    const incident = createIncidentManifest(record, triggerReason)
    await writeManifest(incident)
    const preTriggerEvents = await readEventsInRange(incident.preTriggerStartSeq, record.seq)
    const expectedBaseCount = incident.triggerSeq - incident.preTriggerStartSeq + 1
    const baseWindow = contiguousWindow(preTriggerEvents, incident.preTriggerStartSeq, expectedBaseCount)
    await writeJsonlLines(
      incident.outputFilePath,
      baseWindow.rows.map((entry) => `${JSON.stringify(entry)}\n`)
    )
    if (baseWindow.hasGapAfterPrefix || baseWindow.rows.length !== expectedBaseCount) {
      await sealIncidentIncomplete({
        incident,
        reason: "interrupted"
      })
      return
    }
    await deleteFileIfExists(manifestlessRecoveryPath)
    await appendSummaryLifecycle("incident_opened", {
      incidentId: incident.incidentId,
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
        openIncidentCaptureSync(record, triggerReason)
      } else if (openIncident && record.seq > openIncident.triggerSeq) {
        appendJsonlLineSync(openIncident.outputFilePath, `${JSON.stringify(record)}\n`)
        openIncident = {
          ...openIncident,
          postRemaining: Math.max(0, openIncident.postRemaining - 1),
          updatedAt: new Date().toISOString()
        }
        if (openIncident.postRemaining <= 0) {
          appendIncidentLifecycleSync(openIncident, "incident_closed", {
            reason: "trigger",
            triggerSeq: openIncident.triggerSeq,
            triggerEvent: openIncident.triggerEvent,
            incomplete: false
          })
          try {
            fsSync.unlinkSync(manifestPath)
          } catch (error) {
            if (!isFsErrorCode(error, "ENOENT")) throw error
          }
          appendSummaryLifecycleSync("incident_closed", {
            incidentId: openIncident.incidentId,
            incidentFile: incidentFileReference(openIncident.outputFilePath),
            triggerSeq: openIncident.triggerSeq,
            triggerEvent: openIncident.triggerEvent,
            reason: "trigger"
          })
          openIncident = undefined
        } else {
          writeManifestSync(openIncident)
        }
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
