# Privacy and data handling

## Files written by the plugin

- `~/.config/opencode/codex-accounts.json`
  - plugin-owned OpenAI account rotation/auth state
- `~/.config/opencode/.gitignore`
  - best-effort safety entries for plugin credential/cache/log artifacts
- `~/.local/share/opencode/auth.json`
  - OpenCode provider auth marker/state
- `~/.config/opencode/cache/codex-session-affinity.json`
  - sticky/hybrid session-to-account affinity state
- `~/.config/opencode/cache/codex-snapshots.json`
  - quota snapshot cache used by status/quota views
- `~/.config/opencode/cache/codex-client-version.json`
  - cached Codex client target version (`version`, `fetchedAt`)
- `~/.config/opencode/cache/codex-models-cache-meta.json`
  - shared GitHub model catalog metadata (`etag`, `tag`, `lastChecked`, `url`)
- `~/.config/opencode/cache/codex-models-cache.json`
  - shared GitHub model catalog snapshot
- `~/.config/opencode/cache/codex-models-cache-<hash>.json`
  - account-scoped server model catalog mirror
- `~/.config/opencode/cache/codex-auth-models-<hash>.json`
  - plugin-primary account-scoped model catalog cache
- `~/.config/opencode/logs/codex-plugin/` (optional)
  - request/response snapshot logs when enabled

## Related compatibility caches

- Existing Codex instruction cache files under `~/.config/opencode/cache/` (for example `codex-instructions.md`, `codex-instructions-meta.json`, `gpt-5.1-instructions.md`) may coexist and are preserved.
- Metadata conventions are aligned (`etag`, `tag`, `lastChecked`, `url`) for GitHub-backed cache files.

## Sensitive data handling

- Auth files contain OAuth material and should be treated like credentials.
- Writes use atomic temp+rename and best-effort `0600` permissions.
- Corrupt auth files can be quarantined with bounded retention when quarantine paths/options are used.

## Logging behavior

- Debug logging is opt-in.
- Snapshot logging is opt-in.
- Snapshot writer redacts sensitive auth headers/tokens before persistence.
- OAuth debug lifecycle logs rotate at a configurable size cap.

## Legacy import

Legacy import is explicit via auth menu transfer and does not run implicitly during normal storage loads.
