# Privacy and data handling

## Files written by the plugin

- `~/.config/opencode/codex-accounts.json`
  - plugin-owned OpenAI Codex account rotation/auth state
- `~/.local/share/opencode/auth.json`
  - OpenCode provider auth marker/state
- `~/.config/opencode/logs/codex-plugin/` (optional)
  - request/response snapshot logs when enabled

## Sensitive data handling

- Auth files contain OAuth material and should be treated like credentials.
- Writes use atomic temp+rename and best-effort `0600` permissions.
- Corrupt auth files can be quarantined with bounded retention when quarantine paths/options are used.

## Logging behavior

- Debug logging is opt-in.
- Snapshot logging is opt-in.
- Snapshot writer redacts sensitive auth headers/tokens before persistence.

## Legacy import

Legacy import is explicit via auth menu transfer and does not run implicitly during normal storage loads.
