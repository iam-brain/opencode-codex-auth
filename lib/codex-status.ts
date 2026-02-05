import type { CodexRateLimitSnapshot } from "./types"

export class CodexStatus {
  private snapshots = new Map<string, CodexRateLimitSnapshot>()

  async updateSnapshot(identityKey: string, snap: CodexRateLimitSnapshot) {
    this.snapshots.set(identityKey, snap)
  }

  async getSnapshot(identityKey: string) {
    return this.snapshots.get(identityKey)
  }

  async getAllSnapshots() {
    return Object.fromEntries(this.snapshots.entries())
  }
}
