import { CodexStatus, type HeaderMap } from "../codex-status"
import { saveSnapshots } from "../codex-status-storage"
import { defaultSnapshotsPath } from "../paths"

export function persistRateLimitSnapshotFromResponse(response: Response, identityKey: string | undefined): void {
  if (!identityKey) return

  const headers: HeaderMap = {}
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })

  const status = new CodexStatus()
  const snapshot = status.parseFromHeaders({
    now: Date.now(),
    modelFamily: "codex",
    headers
  })

  if (snapshot.limits.length === 0) return

  void saveSnapshots(defaultSnapshotsPath(), (current) => ({
    ...current,
    [identityKey]: snapshot
  })).catch((error) => {
    if (error instanceof Error) {
      // best-effort snapshot persistence
    }
  })
}
