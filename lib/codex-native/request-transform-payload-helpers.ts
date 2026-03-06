import { isRecord } from "../util.js"

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export type TransformReason =
  | "disabled"
  | "non_post"
  | "empty_body"
  | "invalid_json"
  | "non_object_body"
  | "missing_input_array"
  | "no_reasoning_replay"
  | "no_developer_messages"
  | "permissions_only"
  | "missing_key"
  | "already_matches"
  | "set"
  | "replaced"
  | "updated"

export type ReplayTransformResult = {
  changed: boolean
  reason: TransformReason
  removedPartCount: number
  removedFieldCount: number
}

export type DeveloperRoleRemapTransformResult = {
  changed: boolean
  reason: TransformReason
  remappedCount: number
  preservedCount: number
}

export type PromptCacheKeyTransformResult = {
  changed: boolean
  reason: TransformReason
}

export type CompatSanitizerTransformResult = {
  changed: boolean
  reason: TransformReason
}

export function stripReasoningReplayFromPayload(payload: Record<string, unknown>): ReplayTransformResult {
  if (!Array.isArray(payload.input)) {
    return {
      changed: false,
      reason: "missing_input_array",
      removedPartCount: 0,
      removedFieldCount: 0
    }
  }

  let changed = false
  let removedPartCount = 0
  let removedFieldCount = 0
  const nextInput: unknown[] = []

  for (const item of payload.input) {
    if (isReasoningReplayPart(item)) {
      changed = true
      removedPartCount += 1
      continue
    }

    if (!isRecord(item)) {
      nextInput.push(item)
      continue
    }

    const nextItem: Record<string, unknown> = { ...item }
    const role = asString(nextItem.role)?.toLowerCase()
    if (role === "assistant" && Array.isArray(nextItem.content)) {
      const contentOut: unknown[] = []
      for (const entry of nextItem.content) {
        if (isReasoningReplayPart(entry)) {
          changed = true
          removedPartCount += 1
          continue
        }
        const strippedEntry = stripReasoningReplayFields(entry)
        if (strippedEntry.removed > 0) {
          changed = true
          removedFieldCount += strippedEntry.removed
        }
        contentOut.push(strippedEntry.value)
      }
      nextItem.content = contentOut
    }

    const strippedItem = stripReasoningReplayFields(nextItem)
    if (strippedItem.removed > 0) {
      changed = true
      removedFieldCount += strippedItem.removed
    }
    nextInput.push(strippedItem.value)
  }

  if (!changed) {
    return {
      changed: false,
      reason: "no_reasoning_replay",
      removedPartCount,
      removedFieldCount
    }
  }

  payload.input = nextInput
  return {
    changed: true,
    reason: "updated",
    removedPartCount,
    removedFieldCount
  }
}

export function remapDeveloperMessagesToUserOnPayload(
  payload: Record<string, unknown>
): DeveloperRoleRemapTransformResult {
  if (!Array.isArray(payload.input)) {
    return {
      changed: false,
      reason: "missing_input_array",
      remappedCount: 0,
      preservedCount: 0
    }
  }

  let nextInput: unknown[] | undefined
  let remappedCount = 0
  let preservedCount = 0
  let developerCount = 0
  for (let index = 0; index < payload.input.length; index += 1) {
    const item = payload.input[index]
    if (!isRecord(item)) continue
    if (item.role !== "developer") continue
    developerCount += 1
    if (shouldPreserveDeveloperRole(item)) {
      preservedCount += 1
      continue
    }
    if (!nextInput) nextInput = payload.input.slice()
    nextInput[index] = {
      ...item,
      role: "user"
    }
    remappedCount += 1
  }

  if (!nextInput) {
    return {
      changed: false,
      reason: developerCount === 0 ? "no_developer_messages" : "permissions_only",
      remappedCount,
      preservedCount
    }
  }

  payload.input = nextInput
  return {
    changed: true,
    reason: "updated",
    remappedCount,
    preservedCount
  }
}

export function applyPromptCacheKeyOverrideToPayload(
  payload: Record<string, unknown>,
  promptCacheKey: string | undefined
): PromptCacheKeyTransformResult {
  if (!promptCacheKey) {
    return { changed: false, reason: "missing_key" }
  }

  const current = asString(payload.prompt_cache_key)
  if (current === promptCacheKey) {
    return { changed: false, reason: "already_matches" }
  }

  payload.prompt_cache_key = promptCacheKey
  return {
    changed: true,
    reason: current ? "replaced" : "set"
  }
}

export function rebuildRequestWithJsonBody(request: Request, body: unknown): Request {
  const headers = new Headers(request.headers)
  headers.set("content-type", "application/json")
  headers.delete("content-length")

  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(body),
    redirect: request.redirect,
    signal: request.signal,
    credentials: request.credentials,
    mode: request.mode,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    integrity: request.integrity,
    keepalive: request.keepalive
  })
}

function messageContentToText(value: unknown): string {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return ""
  const parts: string[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    if (typeof entry.text === "string" && entry.text.trim().length > 0) {
      parts.push(entry.text)
    }
  }
  return parts.join("\n")
}

const STRUCTURED_INSTRUCTION_MARKERS = [
  "<permissions instructions>",
  "<environment_context>",
  "<app-context>",
  "<collaboration_mode>",
  "<personality_spec>",
  "<instructions>"
]

const RUNTIME_POLICY_SIGNALS = [
  "approval policy",
  "filesystem sandboxing",
  "sandbox_mode",
  "agents.md",
  "environment context",
  "collaboration mode"
]

const DIRECTIVE_LANGUAGE_SIGNALS = ["must", "never", "do not", "always", "required", "only"]
const POLICY_DOMAIN_SIGNALS = ["permission", "policy", "sandbox", "filesystem", "security", "compliance"]

function shouldPreserveDeveloperRole(item: Record<string, unknown>): boolean {
  const text = messageContentToText(item.content).toLowerCase()
  if (!text) return false
  if (
    text.includes("instructions") &&
    (text.includes("must") || text.includes("never") || text.includes("do not") || text.includes("required"))
  ) {
    return true
  }
  if (STRUCTURED_INSTRUCTION_MARKERS.some((marker) => text.includes(marker))) return true
  const hasDirectiveLanguage = DIRECTIVE_LANGUAGE_SIGNALS.some((signal) => text.includes(signal))
  const hasPolicyDomainSignal = POLICY_DOMAIN_SIGNALS.some((signal) => text.includes(signal))
  if (hasDirectiveLanguage && hasPolicyDomainSignal) return true
  const signalCount = RUNTIME_POLICY_SIGNALS.reduce((count, signal) => count + (text.includes(signal) ? 1 : 0), 0)
  return signalCount >= 2
}

function stripReasoningReplayFields(value: unknown): { value: unknown; removed: number } {
  if (Array.isArray(value)) {
    let removed = 0
    const next = value.map((entry) => {
      const result = stripReasoningReplayFields(entry)
      removed += result.removed
      return result.value
    })
    return { value: next, removed }
  }

  if (!isRecord(value)) {
    return { value, removed: 0 }
  }

  let removed = 0
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key.toLowerCase() === "reasoning_content") {
      removed += 1
      continue
    }
    const result = stripReasoningReplayFields(entry)
    removed += result.removed
    out[key] = result.value
  }
  return { value: out, removed }
}

function isReasoningReplayPart(entry: unknown): boolean {
  if (!isRecord(entry)) return false
  const type = asString(entry.type)?.toLowerCase()
  if (!type) return false
  return type.startsWith("reasoning")
}
