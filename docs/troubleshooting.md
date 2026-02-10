# Troubleshooting

## Quick checks

1. Confirm plugin is installed in `~/.config/opencode/opencode.json`.
2. Confirm config exists at `~/.config/opencode/codex-config.json`.
3. Confirm auth files exist:
   - `~/.local/share/opencode/auth.json`
   - `~/.config/opencode/codex-accounts.json`

## Common issues

### Login appears stuck on callback wait

- Ensure port `1455` is free.
- Close other auth flows (Codex/OpenCode) and retry.

### OpenAI Codex model not found / API key missing

- Re-run `opencode auth login`.
- Verify both auth files above exist and are readable.
- Confirm your selected model slug exists in provider model list.

### Quota output shows `Unknown`

Usually means either:

- account expired and needs re-auth, or
- backend did not return reset timestamp for that window.

Fix:

- open account manager
- run per-account `Refresh token`
- run `Check quotas` again

### Refresh token rejected (`invalid_grant`)

Meaning:

- request exhausted healthy candidates and at least one account requires re-auth.

Fix:

- reauthenticate affected accounts via `opencode auth login`
- disable repeatedly failing accounts temporarily

### Delete-all appears to repopulate

Expected behavior:

- existing `codex-accounts.json` (including empty `accounts: []`) is authoritative.

If accounts reappear:

- check for multiple plugin installs writing concurrently
- check external scripts touching auth files

## Debug mode

Enable:

- `OPENCODE_OPENAI_MULTI_DEBUG=1`
- or `DEBUG_CODEX_PLUGIN=1`

Optional request/response snapshots:

- `OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS=true`
- output in `~/.config/opencode/logs/codex-plugin/`

Sensitive auth headers/tokens are redacted in snapshot logs.
