# Privacy and Data Handling

## File ownership map

Plugin writes:

- `~/.config/opencode/codex-accounts.json` (account store; `lib/storage.ts`)
- `~/.config/opencode/cache/codex-session-affinity.json` (`lib/session-affinity.ts`)
- `~/.config/opencode/cache/codex-snapshots.json` (`lib/codex-status-storage.ts`)
- `~/.config/opencode/logs/codex-plugin/` when snapshot/debug logging is enabled (`lib/request-snapshots.ts`)
- `~/.config/opencode/codex-config.json` if missing (`lib/config.ts`)

OpenCode-owned file used for transfer checks:

- `~/.local/share/opencode/auth.json` (read path in `lib/storage.ts`)

## Sensitive fields

Treat the following as credentials:

- refresh tokens
- access tokens
- OAuth identity claims

Account store files may contain these values and should not be shared.

## Write safety controls

Storage writes use:

- lock-guarded mutation (`proper-lockfile`)
- atomic temp-file + rename writes
- best-effort `0600` permissions

Sources: `lib/storage.ts`, `lib/session-affinity.ts`, `lib/codex-status-storage.ts`.

## Snapshot and debug logging

Snapshot logging is opt-in.

Redactions include:

- `Authorization`
- `Cookie` / `Set-Cookie`
- token-like body fields (`access_token`, `refresh_token`, `id_token`)

Source and coverage:

- `lib/request-snapshots.ts`
- `test/request-snapshots.test.ts`

## Corruption handling

Corrupt auth files can be quarantined and replaced with empty storage on load when quarantine options are provided (`lib/storage.ts`).

Coverage: `test/storage-corruption.test.ts`.
