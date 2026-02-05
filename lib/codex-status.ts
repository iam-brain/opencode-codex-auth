import type { CodexRateLimitSnapshot } from "./types"

export class CodexStatus {
  private snapshots = new Map<string, CodexRateLimitSnapshot>()

  updateSnapshot(identityKey: string, snap: CodexRateLimitSnapshot): void {
    this.snapshots.set(identityKey, snap)
  }

  getSnapshot(identityKey: string): CodexRateLimitSnapshot | undefined {
    return this.snapshots.get(identityKey)
  }

  getAllSnapshots(): Record<string, CodexRateLimitSnapshot> {
    return Object.fromEntries(this.snapshots.entries())
  }
}
