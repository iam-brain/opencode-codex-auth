# Troubleshooting

## Fast diagnostics

Check install and config:

1. `~/.config/opencode/opencode.json` contains `@iam-brain/opencode-codex-auth@latest`.
2. `~/.config/opencode/codex-config.json` exists.
3. `opencode auth login` opens the account manager.

Check plugin-owned storage files:

- `~/.config/opencode/codex-accounts.json`
- `~/.config/opencode/cache/codex-session-affinity.json` (created on demand)
- `~/.config/opencode/cache/codex-snapshots.json` (created on demand)

## Login stuck waiting for callback

Symptoms: browser flow starts but callback does not complete.

Checks:

- Ensure local port `1455` is available (`lib/codex-native.ts`).
- Close other active OAuth flows and retry.
- If running headless, use the headless auth method in the menu.

Optional timeout controls:

- `CODEX_OAUTH_CALLBACK_TIMEOUT_MS`
- `CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS`
- `CODEX_OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS`

## `invalid_grant` or repeated refresh failures

Meaning: refresh token is rejected for at least one account.

Actions:

1. Run `opencode auth login`.
2. Re-authenticate affected account.
3. Disable repeatedly failing accounts until replaced.

Behavior source: `lib/codex-native.ts`, `lib/proactive-refresh.ts`.

## All accounts rate-limited

When all candidates are exhausted, requests return synthetic `429` with guidance (`lib/fetch-orchestrator.ts`).

Actions:

- wait until cooldown expires
- add another account
- verify cooldown logic in account status output

## Model not available

Actions:

- Retry with another available `openai/*` model.
- Re-run `opencode auth login` and verify account is enabled.
- Check catalog refresh behavior in logs if debug is enabled.

Sources: `lib/codex-native.ts`, `lib/model-catalog.ts`.

## `/create-personality` or `personality-builder` missing

Re-run installer:

```bash
npx -y @iam-brain/opencode-codex-auth install
```

Expected files:

- `~/.config/opencode/commands/create-personality.md`
- `~/.config/opencode/skills/personality-builder/SKILL.md`

Source: `lib/installer-cli.ts`, `lib/personality-command.ts`, `lib/personality-skill.ts`.

## Debug logging

Plugin debug:

- `OPENCODE_OPENAI_MULTI_DEBUG=1`
- `DEBUG_CODEX_PLUGIN=1`

OAuth lifecycle debug:

- `CODEX_AUTH_DEBUG=1`

Header/request snapshots:

- `OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS=true`
- `OPENCODE_OPENAI_MULTI_HEADER_TRANSFORM_DEBUG=true`

Snapshot output path:

- `~/.config/opencode/logs/codex-plugin/`

Sensitive headers/tokens are redacted before persistence (`lib/request-snapshots.ts`, `test/request-snapshots.test.ts`).
