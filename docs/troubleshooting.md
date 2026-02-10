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

### OpenAI model not found / API key missing

- Re-run `opencode auth login`.
- Verify both auth files above exist and are readable.
- Confirm your selected model slug exists in provider model list.

### `/create-personality` command not found

- Re-run installer: `npx -y @iam-brain/opencode-codex-auth`
- Verify file exists: `~/.config/opencode/commands/create-personality.md`
- Restart OpenCode so command discovery refreshes.

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
- `CODEX_AUTH_DEBUG=1` (OAuth lifecycle logs)

Optional request/response snapshots:

- `OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS=true`
- output in `~/.config/opencode/logs/codex-plugin/`

Optional OAuth timing controls:

- `CODEX_OAUTH_CALLBACK_TIMEOUT_MS`
- `CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS`
- `CODEX_OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS`

Sensitive auth headers/tokens are redacted in snapshot logs.

For complete config/env reference, see `docs/configuration.md`.
