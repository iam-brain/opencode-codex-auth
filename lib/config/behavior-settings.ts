import type { BehaviorSettings } from "./types.js"

function cloneBehaviorOverride<T extends Record<string, unknown>>(input: T | undefined): T | undefined {
  if (!input) return undefined
  return { ...input }
}

export function cloneBehaviorSettings(input: BehaviorSettings | undefined): BehaviorSettings | undefined {
  if (!input) return undefined
  return {
    ...(input.global
      ? {
          global: cloneBehaviorOverride(input.global)
        }
      : {}),
    perModel: input.perModel
      ? Object.fromEntries(
          Object.entries(input.perModel).map(([key, value]) => [
            key,
            {
              ...cloneBehaviorOverride(value),
              ...(value.variants
                ? {
                    variants: Object.fromEntries(
                      Object.entries(value.variants).map(([variantKey, variantValue]) => [
                        variantKey,
                        cloneBehaviorOverride(variantValue) ?? {}
                      ])
                    )
                  }
                : {})
            }
          ])
        )
      : undefined
  }
}
