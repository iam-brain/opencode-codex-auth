# Troubleshooting

## Quick checks

1. Confirm plugin is installed in resolved `<config-root>/opencode.json` (`$XDG_CONFIG_HOME/opencode` when set, otherwise `~/.config/opencode`).
2. Confirm config exists at the resolved path (`OPENCODE_OPENAI_MULTI_CONFIG_PATH` when set, otherwise exactly one default path: `$XDG_CONFIG_HOME/opencode/codex-config.json` when `XDG_CONFIG_HOME` is set, else `~/.config/opencode/codex-config.json`).
3. Confirm auth files exist:
   - required runtime store: resolved `<config-root>/codex-accounts.json`
   - optional legacy transfer source: `${XDG_DATA_HOME:-~/.local/share}/opencode/auth.json`
4. Confirm cache files exist when relevant features were used (files are created on demand):
   - `<config-root>/cache/codex-client-version.json`
   - `<config-root>/cache/codex-models-cache-meta.json`
   - `<config-root>/cache/codex-models-cache.json`
   - `<config-root>/cache/codex-models-cache-<hash>.json`
   - `<config-root>/cache/codex-auth-models-<hash>.json`
   - `<config-root>/cache/codex-session-affinity.json`
   - `<config-root>/cache/codex-snapshots.json`

## Common issues

### Login appears stuck on callback wait

- Ensure port `1455` is free.
- Close other auth flows (Codex/OpenCode) and retry.

### OpenAI model not found / API key missing

- Re-run `opencode auth login`.
- Verify both auth files above exist and are readable.
- Confirm your selected model slug exists in provider model list.

### `codex-models-cache.json` looks stale after version changes

- `codex-models-cache.json` is the shared GitHub snapshot, refreshed by comparing cached `codex-models-cache-meta.json` tag against the target client version from `codex-client-version.json`.
- Account shard files (`codex-auth-models-*.json`, `codex-models-cache-<hash>.json`) are server catalogs and can differ from shared GitHub cache.
- If shared cache is stuck, remove `codex-models-cache.json` and `codex-models-cache-meta.json`, then rerun a model-catalog path (for example `opencode auth login` followed by a normal model request) to force repopulation.

### `/create-personality` command not found

- Re-run installer: `npx -y @iam-brain/opencode-codex-auth@latest`
- Verify file exists: `<config-root>/commands/create-personality.md`
- Restart OpenCode so command discovery refreshes.

### `personality-builder` skill missing

- Re-run installer: `npx -y @iam-brain/opencode-codex-auth@latest`
- Verify file exists: `<config-root>/skills/personality-builder/SKILL.md`

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

### Status shows `identity-missing`

Meaning:

- an account record is present but does not include identity metadata (`identityKey`), so some features (like quota snapshots keyed by identity) cannot attach.

Fix:

- reauthenticate via `opencode auth login` to refresh identity fields

### Delete-all appears to repopulate

Expected behavior:

- existing `codex-accounts.json` (including empty `accounts: []`) is authoritative.

If accounts reappear:

- check for multiple plugin installs writing concurrently
- check external scripts touching auth files
- stop OpenCode before manually editing `codex-accounts.json` (plugin writes are lock-guarded + atomic and can overwrite ad-hoc edits)

### Corrupt auth file got quarantined

Meaning:

- auth storage JSON could not be parsed, so the plugin moved the file to quarantine and continued with empty auth state.

Where quarantine files go:

- default: `<auth-file-dir>/quarantine/`
- filename pattern: `<original>.<timestamp>.quarantine.json`

Recovery:

- stop OpenCode
- inspect and repair the quarantined JSON backup
- copy the repaired file back to `codex-accounts.json`
- rerun `opencode auth login` if needed to refresh tokens/identity metadata

## Debug mode

Enable:

- `OPENCODE_OPENAI_MULTI_DEBUG=1`
- or `DEBUG_CODEX_PLUGIN=1`
- `CODEX_AUTH_DEBUG=1` (OAuth lifecycle logs; supports `true|yes|on`)

Optional request/response snapshots:

- `OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS=true`
- `OPENCODE_OPENAI_MULTI_HEADER_TRANSFORM_DEBUG=true` (adds `before-header-transform` and `after-header-transform`)
- output in `<config-root>/logs/codex-plugin/`
- snapshot custom metadata is nested under `meta` in snapshot JSON payloads.

Redirect safety errors:

- `blocked_outbound_redirect`: request hit a redirect that failed policy validation.
- `outbound_redirect_limit_exceeded`: request exceeded redirect hop cap.

Optional OAuth timing controls:

- `CODEX_OAUTH_CALLBACK_TIMEOUT_MS`
- `CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS`
- `CODEX_OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS`
- `CODEX_OAUTH_HTTP_TIMEOUT_MS`
- `CODEX_DEVICE_AUTH_TIMEOUT_MS`

Optional OAuth debug log rotation:

- `CODEX_AUTH_DEBUG_MAX_BYTES`

Sensitive auth headers/tokens are redacted in snapshot logs.
Sensitive account/session metadata keys and URL query values are redacted as well.
If request body capture is enabled, prompt/tool payload content may still be present.

For complete config/env reference, see `docs/configuration.md`.
