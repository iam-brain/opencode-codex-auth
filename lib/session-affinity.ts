import fs from "node:fs/promises"
import path from "node:path"

import { defaultSessionAffinityPath, opencodeSessionFilePath } from "./paths"
import type { OpenAIAuthMode } from "./types"
import { withLockedFile } from "./cache-lock"
import { isFsErrorCode, writeJsonFileAtomic } from "./cache-io"
import { isRecord } from "./util"

export const MAX_SESSION_AFFINITY_ENTRIES = 200

type SessionAffinityModeRecord = {
  seenSessionKeys?: Record<string, number>
  stickyBySessionKey?: Record<string, string>
  hybridBySessionKey?: Record<string, string>
}

export type SessionAffinityFile = {
  version: 1
  native?: SessionAffinityModeRecord
  codex?: SessionAffinityModeRecord
}

export type SessionAffinitySnapshot = {
  seenSessionKeys: Map<string, number>
  stickyBySessionKey: Map<string, string>
  hybridBySessionKey: Map<string, string>
}

export type SessionExistsFn = (sessionKey: string) => Promise<boolean>
export type PruneSessionAffinityOptions = {
  now?: number
  missingGraceMs?: number
}

const DEFAULT_FILE: SessionAffinityFile = { version: 1 }

function clampEntries<T>(entries: Array<[string, T]>, maxEntries: number): Array<[string, T]> {
  if (entries.length <= maxEntries) return entries
  return entries.slice(entries.length - maxEntries)
}

function sanitizeStringMap(value: unknown, maxEntries = MAX_SESSION_AFFINITY_ENTRIES): Map<string, string> {
  if (!isRecord(value)) return new Map()
  const entries: Array<[string, string]> = []
  for (const [key, mapValue] of Object.entries(value)) {
    if (key.trim().length === 0 || typeof mapValue !== "string") continue
    entries.push([key, mapValue])
  }
  return new Map(clampEntries(entries, maxEntries))
}

function sanitizeSeenMap(value: unknown, maxEntries = MAX_SESSION_AFFINITY_ENTRIES): Map<string, number> {
  if (!isRecord(value)) return new Map()
  const entries: Array<[string, number]> = []
  for (const [key, mapValue] of Object.entries(value)) {
    if (key.trim().length === 0 || typeof mapValue !== "number" || !Number.isFinite(mapValue)) {
      continue
    }
    entries.push([key, Math.floor(mapValue)])
  }
  entries.sort((left, right) => left[1] - right[1])
  return new Map(clampEntries(entries, maxEntries))
}

function toModeRecord(snapshot: SessionAffinitySnapshot): SessionAffinityModeRecord {
  const seenEntries = clampEntries(
    [...snapshot.seenSessionKeys.entries()].sort((left, right) => left[1] - right[1]),
    MAX_SESSION_AFFINITY_ENTRIES
  )
  const stickyEntries = clampEntries([...snapshot.stickyBySessionKey.entries()], MAX_SESSION_AFFINITY_ENTRIES)
  const hybridEntries = clampEntries([...snapshot.hybridBySessionKey.entries()], MAX_SESSION_AFFINITY_ENTRIES)

  return {
    seenSessionKeys: Object.fromEntries(seenEntries),
    stickyBySessionKey: Object.fromEntries(stickyEntries),
    hybridBySessionKey: Object.fromEntries(hybridEntries)
  }
}

function sanitizeFile(input: unknown): SessionAffinityFile {
  if (!isRecord(input)) return { ...DEFAULT_FILE }
  const out: SessionAffinityFile = { version: 1 }

  for (const mode of ["native", "codex"] as const) {
    const rawMode = input[mode]
    if (!isRecord(rawMode)) continue
    const modeSnapshot: SessionAffinitySnapshot = {
      seenSessionKeys: sanitizeSeenMap(rawMode.seenSessionKeys),
      stickyBySessionKey: sanitizeStringMap(rawMode.stickyBySessionKey),
      hybridBySessionKey: sanitizeStringMap(rawMode.hybridBySessionKey)
    }
    if (
      modeSnapshot.seenSessionKeys.size > 0 ||
      modeSnapshot.stickyBySessionKey.size > 0 ||
      modeSnapshot.hybridBySessionKey.size > 0
    ) {
      out[mode] = toModeRecord(modeSnapshot)
    }
  }

  return out
}

export function readSessionAffinitySnapshot(file: SessionAffinityFile, mode: OpenAIAuthMode): SessionAffinitySnapshot {
  const modeRecord = file[mode]
  return {
    seenSessionKeys: sanitizeSeenMap(modeRecord?.seenSessionKeys),
    stickyBySessionKey: sanitizeStringMap(modeRecord?.stickyBySessionKey),
    hybridBySessionKey: sanitizeStringMap(modeRecord?.hybridBySessionKey)
  }
}

export function writeSessionAffinitySnapshot(
  file: SessionAffinityFile,
  mode: OpenAIAuthMode,
  snapshot: SessionAffinitySnapshot
): SessionAffinityFile {
  const next = sanitizeFile(file)
  const modeRecord = toModeRecord(snapshot)
  if (
    Object.keys(modeRecord.seenSessionKeys ?? {}).length === 0 &&
    Object.keys(modeRecord.stickyBySessionKey ?? {}).length === 0 &&
    Object.keys(modeRecord.hybridBySessionKey ?? {}).length === 0
  ) {
    delete next[mode]
  } else {
    next[mode] = modeRecord
  }
  return next
}

function isSafeSessionKey(sessionKey: string): boolean {
  if (!sessionKey || !sessionKey.trim()) return false
  if (sessionKey.includes("/") || sessionKey.includes("\\") || sessionKey.includes("..")) return false
  return true
}

export function createSessionExistsFn(env: Record<string, string | undefined> = process.env): SessionExistsFn {
  return async (sessionKey: string): Promise<boolean> => {
    if (!isSafeSessionKey(sessionKey)) return false
    const filePath = opencodeSessionFilePath(sessionKey, env)
    try {
      await fs.access(filePath)
      return true
    } catch (error) {
      if (!isFsErrorCode(error, "ENOENT")) {
        // Treat filesystem access errors as a missing session.
      }
      return false
    }
  }
}

export async function pruneSessionAffinitySnapshot(
  snapshot: SessionAffinitySnapshot,
  sessionExists: SessionExistsFn,
  options: PruneSessionAffinityOptions = {}
): Promise<number> {
  const now = options.now ?? Date.now()
  const missingGraceMs = Math.max(0, Math.floor(options.missingGraceMs ?? 0))
  const keySet = new Set<string>([
    ...snapshot.seenSessionKeys.keys(),
    ...snapshot.stickyBySessionKey.keys(),
    ...snapshot.hybridBySessionKey.keys()
  ])

  let removed = 0
  for (const sessionKey of keySet) {
    const exists = await sessionExists(sessionKey)
    if (exists) continue
    const lastSeenAt = snapshot.seenSessionKeys.get(sessionKey)
    if (missingGraceMs > 0 && typeof lastSeenAt === "number" && Number.isFinite(lastSeenAt)) {
      if (now - lastSeenAt <= missingGraceMs) {
        continue
      }
    }
    if (snapshot.seenSessionKeys.delete(sessionKey)) removed += 1
    snapshot.stickyBySessionKey.delete(sessionKey)
    snapshot.hybridBySessionKey.delete(sessionKey)
  }

  return removed
}

async function readUnlocked(filePath: string): Promise<SessionAffinityFile> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, "utf8")
  } catch (error: unknown) {
    if (!isFsErrorCode(error, "ENOENT")) {
      // Fall back to default snapshot when read fails.
    }
    return { ...DEFAULT_FILE }
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    return sanitizeFile(parsed)
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      // Fall back to default snapshot for malformed/unexpected content.
    }
    return { ...DEFAULT_FILE }
  }
}

async function writeUnlocked(filePath: string, file: SessionAffinityFile): Promise<void> {
  await writeJsonFileAtomic(filePath, file)
}

export async function loadSessionAffinity(
  filePath: string = defaultSessionAffinityPath()
): Promise<SessionAffinityFile> {
  return readUnlocked(filePath)
}

export async function saveSessionAffinity(
  update: (current: SessionAffinityFile) => SessionAffinityFile | Promise<SessionAffinityFile>,
  filePath: string = defaultSessionAffinityPath()
): Promise<SessionAffinityFile> {
  return withLockedFile(filePath, async () => {
    const current = await readUnlocked(filePath)
    const next = sanitizeFile(await update(current))
    await writeUnlocked(filePath, next)
    return next
  })
}
