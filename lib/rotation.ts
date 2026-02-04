import type { AccountRecord, RotationStrategy } from "./types"

export type SelectAccountInput = {
  accounts: AccountRecord[]
  strategy?: RotationStrategy
  activeIdentityKey?: string
  now: number
}

function isEligible(account: AccountRecord, now: number): boolean {
  if (account.enabled === false) return false
  if (typeof account.cooldownUntil === "number" && account.cooldownUntil > now) {
    return false
  }
  return true
}

export function selectAccount(input: SelectAccountInput):
  | AccountRecord
  | undefined {
  const { accounts, now, activeIdentityKey } = input
  const strategy: RotationStrategy = input.strategy ?? "round_robin"

  const eligible = accounts.filter((acc) => isEligible(acc, now))
  if (eligible.length === 0) return undefined

  const activeIndex =
    activeIdentityKey == null
      ? -1
      : eligible.findIndex((acc) => acc.identityKey === activeIdentityKey)

  if (strategy === "sticky") {
    if (activeIndex >= 0) return eligible[activeIndex]
    return eligible[0]
  }

  if (strategy === "hybrid") {
    if (activeIndex >= 0) return eligible[activeIndex]
    let selected = eligible[0]
    let selectedLastUsed = selected.lastUsed ?? 0
    for (let i = 1; i < eligible.length; i++) {
      const candidate = eligible[i]
      const candidateLastUsed = candidate.lastUsed ?? 0
      if (candidateLastUsed > selectedLastUsed) {
        selected = candidate
        selectedLastUsed = candidateLastUsed
      }
    }
    return selected
  }

  if (activeIndex < 0) return eligible[0]
  return eligible[(activeIndex + 1) % eligible.length]
}
