export function switchToolMessage(input: { email?: string; plan?: string; index1: number }) {
  const label = input.email ?? "account"
  const plan = input.plan ? ` (${input.plan})` : ""
  return `Switched to #${input.index1}: ${label}${plan}`
}
