import type { PluginInput } from "@opencode-ai/plugin"

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function getMessageProviderID(info: Record<string, unknown>): string | undefined {
  const model = isRecord(info.model) ? info.model : undefined
  return model ? asString(model.providerID) : asString(info.providerID)
}

export async function readSessionMessageRows(
  client: PluginInput["client"] | undefined,
  sessionID: string
): Promise<unknown[]> {
  const sessionApi = client?.session as { messages: (input: unknown) => Promise<unknown> } | undefined
  if (!sessionApi || typeof sessionApi.messages !== "function") return []

  try {
    const response = await sessionApi.messages({ sessionID, limit: 100 })
    return isRecord(response) && Array.isArray(response.data) ? response.data : []
  } catch (error) {
    if (error instanceof Error) {
      // best-effort session inspection
    }
    return []
  }
}

export async function sessionUsesOpenAIProvider(
  client: PluginInput["client"] | undefined,
  sessionID: string
): Promise<boolean> {
  const rows = await readSessionMessageRows(client, sessionID)
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (!isRecord(row) || !isRecord(row.info)) continue
    const info = row.info
    if (asString(info.role) !== "user") continue
    const providerID = getMessageProviderID(info)
    if (!providerID) continue
    return providerID === "openai"
  }

  return false
}

export async function readSessionMessageInfo(
  client: PluginInput["client"] | undefined,
  sessionID: string,
  messageID: string
): Promise<Record<string, unknown> | undefined> {
  const rows = await readSessionMessageRows(client, sessionID)
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (!isRecord(row) || !isRecord(row.info)) continue
    const info = row.info
    if (asString(info.id) !== messageID) continue
    return info
  }

  return undefined
}
