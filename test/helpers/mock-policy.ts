import { vi } from "vitest"

export function stubGlobalForTest<K extends keyof typeof globalThis>(key: K, value: (typeof globalThis)[K]): void {
  vi.stubGlobal(key, value)
}

export function resetStubbedGlobals(): void {
  vi.unstubAllGlobals()
}
