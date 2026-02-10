# Troubleshooting

## OAuth callback issues

Browser OAuth uses a local callback server on `http://localhost:1455/auth/callback`.

If the port is already in use, stop other Codex/OpenCode auth flows and retry.

## Corrupt codex-accounts.json

If `~/.config/opencode/codex-accounts.json` (plugin multi-account store) becomes corrupt JSON, the storage layer can quarantine the file (bounded retention) and return an empty storage object.

## OpenAI model not found / API key missing

If OpenCode reports `ProviderModelNotFoundError` for `openai/*` or `OpenAI API key is missing`, verify both auth files exist and are valid:

- `~/.local/share/opencode/auth.json` (OpenCode OAuth marker)
- `~/.config/opencode/codex-accounts.json` (plugin multi-account store)

On first run, the plugin can bootstrap `codex-accounts.json` from legacy files and from the OpenCode provider marker.

If needed, run `opencode auth login` again to refresh provider auth state.

## Quota output shows Unknown

`Check quotas` fetches live quota data. Unknown reset labels usually mean:

- account is expired and needs reauth, or
- backend did not return a reset timestamp for that window.

Run `opencode auth login` and use per-account `Refresh token`, then run `Check quotas` again.

## Refresh token rejected (`invalid_grant`)

If the plugin returns a refresh-token error, all enabled candidates were exhausted for that request and at least one account needs reauthentication.

- Run `opencode auth login` to refresh credentials.
- If multiple accounts are configured, the plugin will automatically fail over when possible.
- For repeatedly failing accounts, switch away (`codex-switch-accounts`) or disable (`codex-toggle-account`) and retry.

## Delete all accounts appears to repopulate

Current behavior: if `codex-accounts.json` exists and has `accounts: []`, that empty state is authoritative and should not auto-reimport legacy files.

If accounts reappear, check for custom scripts or multiple plugin installs writing to auth files in parallel.

## Rate limits

On `429` responses, the plugin parses `Retry-After`, persists a per-account cooldown, and retries with another enabled account when possible.

## Debug logs

Enable debug logs with `OPENCODE_OPENAI_AUTH_DEBUG=1`.

Rotation tracing is now included in debug mode:

- `rotation begin`
- `rotation decision`
- `rotation candidate selected`
- `rotation stop: ...`

These events include strategy, session key, active/selected identity keys, and why selection stopped or switched.
