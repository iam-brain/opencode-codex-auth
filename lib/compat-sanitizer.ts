import { isRecord } from "./util.js"

type CompatSanitizeResult = {
  payload: Record<string, unknown>
  changed: boolean
}

function sanitizeItemReferences(value: unknown): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const result = sanitizeItemReferences(item)
      changed = changed || result.changed
      return result.value
    })
    return { value: next, changed }
  }

  if (!isRecord(value)) {
    return { value, changed: false }
  }

  let changed = false
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === "item_reference") {
      changed = true
      continue
    }
    const result = sanitizeItemReferences(child)
    out[key] = result.value
    changed = changed || result.changed
  }
  return { value: out, changed }
}

function hasCallId(item: Record<string, unknown>): boolean {
  const callId = item.call_id
  const toolCallId = item.tool_call_id
  return (
    (typeof callId === "string" && callId.trim().length > 0) ||
    (typeof toolCallId === "string" && toolCallId.trim().length > 0)
  )
}

function extractOutputText(item: Record<string, unknown>): string {
  const candidates = [item.output_text, item.output, item.content]
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate
    }
    if (candidate !== undefined && candidate !== null && typeof candidate !== "function") {
      try {
        const text = JSON.stringify(candidate)
        if (text && text !== "null" && text !== "{}" && text !== "[]") {
          return text
        }
      } catch (error) {
        if (error instanceof Error) {
          // Keep searching.
        }
        // Keep searching.
      }
    }
  }
  return "[sanitized orphaned tool output]"
}

function normalizeOrphanedToolOutput(item: unknown): { value: unknown; changed: boolean } {
  if (!isRecord(item)) return { value: item, changed: false }
  const type = typeof item.type === "string" ? item.type : ""
  if (type !== "function_call_output" && type !== "tool_output" && type !== "tool_result") {
    return { value: item, changed: false }
  }
  if (hasCallId(item)) {
    return { value: item, changed: false }
  }

  return {
    value: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: extractOutputText(item) }]
    },
    changed: true
  }
}

function sanitizeInputItems(items: unknown[]): { items: unknown[]; changed: boolean } {
  let changed = false
  const nextItems = items.map((item) => {
    const referenceResult = sanitizeItemReferences(item)
    const orphanResult = normalizeOrphanedToolOutput(referenceResult.value)
    changed = changed || referenceResult.changed || orphanResult.changed
    return orphanResult.value
  })
  return { items: nextItems, changed }
}

export function sanitizeRequestPayloadForCompat(payload: Record<string, unknown>): CompatSanitizeResult {
  const input = payload.input
  if (!Array.isArray(input)) {
    return { payload, changed: false }
  }

  const { items, changed } = sanitizeInputItems(input)
  if (!changed) {
    return { payload, changed: false }
  }

  return {
    payload: {
      ...payload,
      input: items
    },
    changed: true
  }
}
