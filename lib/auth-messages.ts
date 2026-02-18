type AccountLabelInput = {
  email?: string
  plan?: string
}

function accountLabel(input: AccountLabelInput): string {
  const label = input.email ?? "account"
  const plan = input.plan ? ` (${input.plan})` : ""
  return `${label}${plan}`
}

export function switchedAccountMessage(input: AccountLabelInput & { index1: number }): string {
  return `Switched to #${input.index1}: ${accountLabel(input)}`
}

export function toggledAccountMessage(input: AccountLabelInput & { index1: number; enabled: boolean }): string {
  return `Updated #${input.index1}: ${accountLabel(input)} -> ${input.enabled ? "enabled" : "disabled"}`
}

export function removedAccountMessage(input: AccountLabelInput & { index1: number }): string {
  return `Removed #${input.index1}: ${accountLabel(input)}`
}
