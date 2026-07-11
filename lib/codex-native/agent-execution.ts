import type { Hooks } from "@opencode-ai/plugin"

type OpenCodeConfig = Parameters<NonNullable<Hooks["config"]>>[0]

export type OpenCodeAgentMode = "primary" | "subagent" | "all"
export type AgentExecutionRole = "root" | "child" | "auxiliary"
export type AgentExecutionReason =
  | "session_parent"
  | "session_root"
  | "configured_primary"
  | "configured_subagent"
  | "builtin_primary"
  | "builtin_subagent"
  | "builtin_auxiliary"
  | "conservative_fallback"

export type AgentExecution = {
  role: AgentExecutionRole
  reason: AgentExecutionReason
  agentName?: string
  configuredMode?: OpenCodeAgentMode
}

type SessionClient = {
  session?: {
    get?: (options: { path: { id: string } }) => Promise<{
      data?: { id?: unknown; parentID?: unknown }
      error?: unknown
    }>
  }
}

const BUILTIN_PRIMARY_AGENTS = new Set(["build", "plan"])
const BUILTIN_SUBAGENTS = new Set(["general", "explore", "scout"])
const BUILTIN_AUXILIARY_AGENTS = new Set(["title", "summary", "compaction", "compact"])

function normalizeAgentName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-")
  return normalized || undefined
}

function normalizeMode(value: unknown): OpenCodeAgentMode | undefined {
  return value === "primary" || value === "subagent" || value === "all" ? value : undefined
}

export function readAgentModes(config: OpenCodeConfig): Map<string, OpenCodeAgentMode> {
  const modes = new Map<string, OpenCodeAgentMode>()
  const agents = (config as OpenCodeConfig & { agent?: Record<string, { mode?: unknown }> }).agent
  if (!agents) return modes

  for (const [name, value] of Object.entries(agents)) {
    const normalizedName = normalizeAgentName(name)
    const mode = normalizeMode(value?.mode)
    if (normalizedName && mode) modes.set(normalizedName, mode)
  }
  return modes
}

export function classifyAgentExecutionFallback(input: {
  agentName?: unknown
  configuredModes?: ReadonlyMap<string, OpenCodeAgentMode>
}): AgentExecution {
  const agentName = normalizeAgentName(input.agentName)
  const configuredMode = agentName ? input.configuredModes?.get(agentName) : undefined

  if (agentName && BUILTIN_AUXILIARY_AGENTS.has(agentName)) {
    return { role: "auxiliary", reason: "builtin_auxiliary", agentName, configuredMode }
  }
  if (configuredMode === "primary") {
    return { role: "root", reason: "configured_primary", agentName, configuredMode }
  }
  if (configuredMode === "subagent") {
    return { role: "child", reason: "configured_subagent", agentName, configuredMode }
  }
  if (agentName && BUILTIN_PRIMARY_AGENTS.has(agentName)) {
    return { role: "root", reason: "builtin_primary", agentName, configuredMode }
  }
  if (agentName && BUILTIN_SUBAGENTS.has(agentName)) {
    return { role: "child", reason: "builtin_subagent", agentName, configuredMode }
  }

  // Unknown and mode:all agents cannot be proven root when session lookup is unavailable.
  return { role: "child", reason: "conservative_fallback", agentName, configuredMode }
}

export function createAgentExecutionResolver(input: { client?: SessionClient }) {
  let configuredModes = new Map<string, OpenCodeAgentMode>()
  const sessionRoles = new Map<string, "root" | "child">()
  const sessionGenerations = new Map<string, number>()
  const pendingSessionRoles = new Map<string, Promise<"root" | "child" | undefined>>()

  const fetchSessionRole = async (sessionID: string): Promise<"root" | "child" | undefined> => {
    const getSession = input.client?.session?.get
    if (!getSession) return undefined

    const generation = sessionGenerations.get(sessionID) ?? 0
    try {
      const response = await getSession({ path: { id: sessionID } })
      if (response.error || response.data?.id !== sessionID) return undefined
      const parentID = response.data.parentID
      if (parentID !== undefined && parentID !== null && typeof parentID !== "string") return undefined
      const role = typeof parentID === "string" && parentID.trim() ? "child" : "root"
      if ((sessionGenerations.get(sessionID) ?? 0) === generation) sessionRoles.set(sessionID, role)
      return role
    } catch {
      return undefined
    }
  }

  return {
    updateConfig(config: OpenCodeConfig): void {
      configuredModes = readAgentModes(config)
    },
    deleteSession(sessionID: string): void {
      sessionRoles.delete(sessionID)
      sessionGenerations.set(sessionID, (sessionGenerations.get(sessionID) ?? 0) + 1)
      pendingSessionRoles.delete(sessionID)
    },
    async resolve(options: { sessionID?: string; agentName?: unknown }): Promise<AgentExecution> {
      const fallback = classifyAgentExecutionFallback({
        agentName: options.agentName,
        configuredModes
      })
      if (fallback.role === "auxiliary") return fallback

      const sessionID = options.sessionID?.trim()
      if (!sessionID || !input.client?.session?.get) return fallback

      const generation = sessionGenerations.get(sessionID) ?? 0

      const cached = sessionRoles.get(sessionID)
      if (cached) {
        return { ...fallback, role: cached, reason: cached === "child" ? "session_parent" : "session_root" }
      }

      let pending = pendingSessionRoles.get(sessionID)
      if (!pending) {
        pending = fetchSessionRole(sessionID)
        pendingSessionRoles.set(sessionID, pending)
        void pending.finally(() => {
          if (pendingSessionRoles.get(sessionID) === pending) pendingSessionRoles.delete(sessionID)
        })
      }
      const role = await pending
      if ((sessionGenerations.get(sessionID) ?? 0) !== generation) {
        return { ...fallback, role: "child", reason: "conservative_fallback" }
      }
      return role ? { ...fallback, role, reason: role === "child" ? "session_parent" : "session_root" } : fallback
    }
  }
}

export function deletedSessionIDFromEvent(event: unknown): string | undefined {
  if (!event || typeof event !== "object" || (event as { type?: unknown }).type !== "session.deleted") return undefined
  const properties = (event as { properties?: unknown }).properties
  if (!properties || typeof properties !== "object") return undefined
  const info = (properties as { info?: unknown }).info
  if (info && typeof info === "object" && typeof (info as { id?: unknown }).id === "string") {
    return (info as { id: string }).id
  }
  return typeof (properties as { id?: unknown }).id === "string" ? (properties as { id: string }).id : undefined
}
