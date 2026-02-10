import type { AccountRecord, RotationStrategy } from "./types"

const DEFAULT_SESSION_ASSIGNMENT_MAX = 200

export type StickySessionState = {
  bySessionKey: Map<string, string>
  cursor: number
  maxEntries?: number
}

export function createStickySessionState(maxEntries = DEFAULT_SESSION_ASSIGNMENT_MAX): StickySessionState {
  return {
    bySessionKey: new Map<string, string>(),
    cursor: 0,
    maxEntries
  }
}

export type SelectAccountInput = {
  accounts: AccountRecord[]
  strategy?: RotationStrategy
  activeIdentityKey?: string
  now: number
  stickyPidOffset?: boolean
  pid?: number
  stickySessionKey?: string | null
  stickySessionState?: StickySessionState
  onDebug?: (event: RotationDebugEvent) => void
}

export type RotationDebugEvent = {
  strategy: RotationStrategy
  decision:
    | "none-eligible"
    | "sticky-session-reuse"
    | "sticky-session-assign"
    | "sticky-fallback-first"
    | "sticky-active"
    | "sticky-pid-offset"
    | "hybrid-session-reuse"
    | "hybrid-session-assign"
    | "hybrid-active"
    | "hybrid-lru"
    | "round-robin-next"
    | "round-robin-pid-offset"
  selectedIdentityKey?: string
  activeIdentityKey?: string
  sessionKey?: string
  eligibleCount: number
  extra?: Record<string, unknown>
}

function isEligible(account: AccountRecord, now: number): boolean {
  if (account.enabled === false) return false
  if (typeof account.cooldownUntil === "number" && account.cooldownUntil > now) {
    return false
  }
  return true
}

function toNonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(Math.abs(value)))
}

function resolveOffsetIndex(input: SelectAccountInput, eligibleLength: number): number {
  if (eligibleLength <= 1) return 0
  if (input.stickyPidOffset !== true) return 0

  const pid = toNonNegativeInt(input.pid ?? process.pid)
  return pid % eligibleLength
}

function resolveStickySessionAccount(
  input: SelectAccountInput,
  eligible: AccountRecord[]
): AccountRecord | undefined {
  const state = input.stickySessionState
  const sessionKey = input.stickySessionKey?.trim()
  if (!state || !sessionKey) return undefined

  const assignedIdentityKey = state.bySessionKey.get(sessionKey)
  if (assignedIdentityKey) {
    const assigned = eligible.find((acc) => acc.identityKey === assignedIdentityKey)
    if (assigned) {
      input.onDebug?.({
        strategy: "sticky",
        decision: "sticky-session-reuse",
        selectedIdentityKey: assigned.identityKey,
        activeIdentityKey: input.activeIdentityKey,
        sessionKey,
        eligibleCount: eligible.length
      })
      return assigned
    }
    state.bySessionKey.delete(sessionKey)
  }

  if (eligible.length === 0) return undefined
  const index = state.cursor % eligible.length
  state.cursor = (state.cursor + 1) % eligible.length
  const selected = eligible[index]
  if (!selected) return undefined
  if (selected.identityKey) {
    state.bySessionKey.set(sessionKey, selected.identityKey)
    const maxEntries = Math.max(1, Math.floor(state.maxEntries ?? DEFAULT_SESSION_ASSIGNMENT_MAX))
    while (state.bySessionKey.size > maxEntries) {
      const oldest = state.bySessionKey.keys().next().value as string | undefined
      if (!oldest) break
      state.bySessionKey.delete(oldest)
    }
  }
  input.onDebug?.({
    strategy: "sticky",
    decision: "sticky-session-assign",
    selectedIdentityKey: selected.identityKey,
    activeIdentityKey: input.activeIdentityKey,
    sessionKey,
    eligibleCount: eligible.length,
    extra: { sessionCursor: state.cursor }
  })
  return selected
}

function resolveHybridSessionAccount(
  input: SelectAccountInput,
  eligible: AccountRecord[]
): AccountRecord | undefined {
  const state = input.stickySessionState
  const sessionKey = input.stickySessionKey?.trim()
  if (!state || !sessionKey) return undefined

  const assignedIdentityKey = state.bySessionKey.get(sessionKey)
  if (assignedIdentityKey) {
    const assigned = eligible.find((acc) => acc.identityKey === assignedIdentityKey)
    if (assigned) {
      input.onDebug?.({
        strategy: "hybrid",
        decision: "hybrid-session-reuse",
        selectedIdentityKey: assigned.identityKey,
        activeIdentityKey: input.activeIdentityKey,
        sessionKey,
        eligibleCount: eligible.length
      })
      return assigned
    }
    state.bySessionKey.delete(sessionKey)
  }

  const ordered = [...eligible].sort((left, right) => {
    const leftLastUsed = left.lastUsed ?? 0
    const rightLastUsed = right.lastUsed ?? 0
    if (leftLastUsed !== rightLastUsed) return leftLastUsed - rightLastUsed
    return (left.identityKey ?? "").localeCompare(right.identityKey ?? "")
  })
  if (ordered.length === 0) return undefined

  const index = state.cursor % ordered.length
  state.cursor = (state.cursor + 1) % ordered.length
  const selected = ordered[index]
  if (!selected) return undefined
  if (selected.identityKey) {
    state.bySessionKey.set(sessionKey, selected.identityKey)
    const maxEntries = Math.max(1, Math.floor(state.maxEntries ?? DEFAULT_SESSION_ASSIGNMENT_MAX))
    while (state.bySessionKey.size > maxEntries) {
      const oldest = state.bySessionKey.keys().next().value as string | undefined
      if (!oldest) break
      state.bySessionKey.delete(oldest)
    }
  }
  input.onDebug?.({
    strategy: "hybrid",
    decision: "hybrid-session-assign",
    selectedIdentityKey: selected.identityKey,
    activeIdentityKey: input.activeIdentityKey,
    sessionKey,
    eligibleCount: eligible.length,
    extra: { sessionCursor: state.cursor }
  })
  return selected
}

export function selectAccount(input: SelectAccountInput):
  | AccountRecord
  | undefined {
  const { accounts, now, activeIdentityKey } = input
  const strategy: RotationStrategy = input.strategy ?? "sticky"

  const eligible = accounts.filter((acc) => isEligible(acc, now))
  if (eligible.length === 0) {
    input.onDebug?.({
      strategy,
      decision: "none-eligible",
      activeIdentityKey,
      eligibleCount: 0
    })
    return undefined
  }

  const activeIndex =
    activeIdentityKey == null
      ? -1
      : eligible.findIndex((acc) => acc.identityKey === activeIdentityKey)

  if (strategy === "sticky") {
    const stickySessionAccount =
      input.stickyPidOffset === true ? resolveStickySessionAccount(input, eligible) : undefined
    if (stickySessionAccount) return stickySessionAccount
    if (activeIndex >= 0) {
      const selected = eligible[activeIndex]
      input.onDebug?.({
        strategy,
        decision: "sticky-active",
        selectedIdentityKey: selected?.identityKey,
        activeIdentityKey,
        eligibleCount: eligible.length
      })
      return selected
    }
    if (input.stickyPidOffset !== true) {
      const selected = eligible[0]
      input.onDebug?.({
        strategy,
        decision: "sticky-fallback-first",
        selectedIdentityKey: selected?.identityKey,
        activeIdentityKey,
        eligibleCount: eligible.length
      })
      return selected
    }
    const offsetIndex = resolveOffsetIndex(input, eligible.length)
    const selected = eligible[offsetIndex]
    input.onDebug?.({
      strategy,
      decision: "sticky-pid-offset",
      selectedIdentityKey: selected?.identityKey,
      activeIdentityKey,
      eligibleCount: eligible.length,
      extra: { offsetIndex }
    })
    return selected
  }

  if (strategy === "hybrid") {
    if (input.stickyPidOffset === true) {
      const sessionAccount = resolveHybridSessionAccount(input, eligible)
      if (sessionAccount) return sessionAccount
    }
    if (activeIndex >= 0) {
      const selected = eligible[activeIndex]
      input.onDebug?.({
        strategy,
        decision: "hybrid-active",
        selectedIdentityKey: selected?.identityKey,
        activeIdentityKey,
        eligibleCount: eligible.length
      })
      return selected
    }
    let selected = eligible[0]
    let selectedLastUsed = selected.lastUsed ?? 0
    for (let i = 1; i < eligible.length; i++) {
      const candidate = eligible[i]
      const candidateLastUsed = candidate.lastUsed ?? 0
      if (
        candidateLastUsed < selectedLastUsed ||
        (candidateLastUsed === selectedLastUsed &&
          (candidate.identityKey ?? "") < (selected.identityKey ?? ""))
      ) {
        selected = candidate
        selectedLastUsed = candidateLastUsed
      }
    }
    input.onDebug?.({
      strategy,
      decision: "hybrid-lru",
      selectedIdentityKey: selected.identityKey,
      activeIdentityKey,
      eligibleCount: eligible.length,
      extra: { lastUsed: selected.lastUsed ?? 0 }
    })
    return selected
  }

  if (activeIndex < 0) {
    const offsetIndex = resolveOffsetIndex(input, eligible.length)
    const selected = eligible[offsetIndex]
    input.onDebug?.({
      strategy,
      decision: "round-robin-pid-offset",
      selectedIdentityKey: selected?.identityKey,
      activeIdentityKey,
      eligibleCount: eligible.length,
      extra: { offsetIndex }
    })
    return selected
  }
  const selected = eligible[(activeIndex + 1) % eligible.length]
  input.onDebug?.({
    strategy,
    decision: "round-robin-next",
    selectedIdentityKey: selected?.identityKey,
    activeIdentityKey,
    eligibleCount: eligible.length,
    extra: { activeIndex }
  })
  return selected
}
