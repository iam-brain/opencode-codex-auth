# Configuration

This plugin uses one runtime config file:

- `~/.config/opencode/codex-config.json`

If it does not exist, the plugin creates it with defaults on startup.

## JSON schemas

Use these schemas for validation/autocomplete:

- `schemas/codex-config.schema.json` -> `codex-config.json`
- `schemas/opencode.schema.json` -> `opencode.json`
- `schemas/codex-accounts.schema.json` -> `codex-accounts.json` (advanced/manual recovery only)

## Config path resolution

The plugin loads config in this order:

1. `OPENCODE_OPENAI_MULTI_CONFIG_PATH`
2. `$XDG_CONFIG_HOME/opencode/codex-config.json`
3. `~/.config/opencode/codex-config.json`

## Default generated config

```json
{
  "$schema": "https://schemas.iam-brain.dev/opencode-codex-auth/codex-config.schema.json",
  "debug": false,
  "quiet": false,
  "refreshAhead": {
    "enabled": true,
    "bufferMs": 60000
  },
  "runtime": {
    "mode": "native",
    "sanitizeInputs": false,
    "headerSnapshots": false,
    "pidOffset": false
  },
  "global": {
    "personality": "pragmatic",
    "thinkingSummaries": false
  },
  "perModel": {}
}
```

## Settings reference

### Top-level

- `debug: boolean`
  - Enables plugin debug logging (`false` default).
- `quiet: boolean`
  - Suppresses plugin toast/UI notifications (`false` default).
- `refreshAhead.enabled: boolean`
  - Enables proactive token refresh (`true` default).
- `refreshAhead.bufferMs: number`
  - Refresh lead time in milliseconds before expiry (`60000` default).

### Runtime

- `runtime.mode: "native" | "codex" | "collab"`
  - `native`: native OpenCode-style identity/headers.
  - `codex`: codex-rs-style identity/headers.
  - `collab`: codex collaboration profile hooks (WIP/untested).
- `runtime.sanitizeInputs: boolean`
  - Sanitizes outbound payloads for provider-compat edge cases.
- `runtime.headerSnapshots: boolean`
  - Writes before/after request header snapshots to debug logs.
- `runtime.pidOffset: boolean`
  - Enables session-aware offset behavior for account selection.

### Model behavior

- `global.personality: string`
  - Personality key applied to all models unless overridden.
- `global.thinkingSummaries: boolean`
  - Global thinking-summary preference.
- `perModel.<model>.personality: string`
  - Model-specific personality override.
- `perModel.<model>.thinkingSummaries: boolean`
  - Model-specific summary override.
- `perModel.<model>.variants.<variant>.personality: string`
  - Variant-level personality override.
- `perModel.<model>.variants.<variant>.thinkingSummaries: boolean`
  - Variant-level summary override.

Precedence for `personality` and `thinkingSummaries`:

1. `perModel.<model>.variants.<variant>`
2. `perModel.<model>`
3. `global`

## Personality system

Built-in personalities from model metadata:

- `friendly`
- `pragmatic`

Custom personalities:

- Store files in:
  - project-local: `.opencode/personalities/<key>.md`
  - global: `~/.config/opencode/personalities/<key>.md`
- Key format:
  - lowercase safe slug (no `/`, `\`, or `..`)
- Pattern recommendation (same shape as native-friendly/pragmatic behavior):
  - keep a stable "core assistant contract" (coding agent, safety, correctness, no fabricated output)
  - layer style/tone/collaboration preferences under separate sections
  - add explicit guardrails and anti-patterns

### `/create-personality` workflow

Installer and startup bootstrap a slash command:

- `/create-personality`

And a tool:

- `create-personality`

Flow:

1. Run `/create-personality`.
2. The assistant interviews you (inspiration, tone, coding style, guardrails, examples).
3. The assistant calls `create-personality`.
4. A new profile is written under `personalities/<key>.md`.
5. Set the key in `codex-config.json` via `global.personality` or `perModel`.

## Why `runtime.mode` exists (and no `identityMode`)

- `runtime.mode` is the only canonical mode setting.
- Identity behavior is derived from mode:
  - `native` -> native identity
  - `codex|collab` -> codex identity
- `spoofMode` is internal compatibility plumbing (and env override support), not a user-facing canonical config key.

## Environment variables

### Config/mode overrides

- `OPENCODE_OPENAI_MULTI_CONFIG_PATH`: absolute config file path.
- `OPENCODE_OPENAI_MULTI_MODE`: `native|codex|collab`.
- `OPENCODE_OPENAI_MULTI_SPOOF_MODE`: advanced identity override (`native|codex`).
- `XDG_CONFIG_HOME`: changes config/agents/personality roots.

### Runtime overrides

- `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH_BUFFER_MS`: integer ms.
- `OPENCODE_OPENAI_MULTI_QUIET`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_PID_OFFSET`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_PERSONALITY`: personality key override.
- `OPENCODE_OPENAI_MULTI_THINKING_SUMMARIES`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_COMPAT_INPUT_SANITIZER`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS`: `1|0|true|false`.

### Debug/OAuth controls

- `OPENCODE_OPENAI_MULTI_DEBUG=1`: plugin debug logs.
- `DEBUG_CODEX_PLUGIN=1`: alternate debug flag.
- `CODEX_AUTH_DEBUG=1`: verbose OAuth lifecycle logging.
- `CODEX_OAUTH_CALLBACK_TIMEOUT_MS`: OAuth wait timeout (min `60000`).
- `CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS`: success-page shutdown grace.
- `CODEX_OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS`: error-page shutdown grace.
- `OPENCODE_NO_BROWSER=1`: disables browser auto-open.
- `NO_COLOR=1`: disables ANSI color blocks in quota UI.

## Compatibility keys (parsed, non-canonical)

Accepted for migration compatibility:

- top-level `personality`
- top-level `customSettings`
- `customSettings.thinkingSummaries`
- `customSettings.options.personality`
- `customSettings.models`

Prefer canonical keys (`global`, `perModel`) for all new edits.
