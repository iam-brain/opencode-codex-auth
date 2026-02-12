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

`codex-config.json` supports JSON comments (`//` and `/* ... */`) for readability.

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
    "rotationStrategy": "sticky",
    "sanitizeInputs": false,
    "developerMessagesToUser": true,
    "headerSnapshots": false,
    "headerTransformDebug": false,
    "pidOffset": false
  },
  "global": {
    "personality": "pragmatic"
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

- `runtime.mode: "native" | "codex"`
  - `native`: carbon-copy target of standard OpenCode native plugin identity/header behavior.
  - `codex`: full codex-rs spoof identity/header behavior.
- `runtime.rotationStrategy: "sticky" | "hybrid" | "round_robin"`
  - `sticky`: one active account until limits/health require change (default).
  - `hybrid`: prefers active account, falls back to healthiest/LRU behavior.
  - `round_robin`: rotates every message (higher token/cache churn).
- `runtime.sanitizeInputs: boolean`
  - Sanitizes outbound payloads for provider-compat edge cases.
- `runtime.developerMessagesToUser: boolean`
  - In `codex` mode, remaps non-permissions `developer` messages to `user` (`true` default).
  - Set to `false` to preserve all `developer` roles.
- `runtime.codexCompactionOverride: boolean`
  - Enables codex-rs compact prompt + `summary_prefix` handoff behavior for OpenAI sessions.
  - Mode defaults: `true` in `codex`, `false` in `native`.
  - Explicit boolean value overrides mode default.
- `runtime.headerSnapshots: boolean`
  - Writes before/after request header snapshots to debug logs.
- `runtime.headerTransformDebug: boolean`
  - Adds explicit `before-header-transform` and `after-header-transform` request snapshots for message fetches.
- `runtime.pidOffset: boolean`
  - Enables session-aware offset behavior for account selection.

### Model behavior

- `global.personality: string`
  - Personality key applied to all models unless overridden.
- `global.thinkingSummaries: boolean`
  - Global thinking-summary preference. Omit to use model/catalog default.
- `perModel.<model>.personality: string`
  - Model-specific personality override.
- `perModel.<model>.thinkingSummaries: boolean`
  - Model-specific summary override (`true` force-on, `false` force-off).
- `perModel.<model>.variants.<variant>.personality: string`
  - Variant-level personality override.
- `perModel.<model>.variants.<variant>.thinkingSummaries: boolean`
  - Variant-level summary override (`true` force-on, `false` force-off).

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

And a managed skill bundle:

- `~/.config/opencode/skills/personality-builder/SKILL.md`

Flow:

1. Run `/create-personality`.
2. The assistant interviews you (inspiration, tone, coding style, guardrails, examples).
3. The assistant calls `create-personality`.
4. A new profile is written under `personalities/<key>.md`.
5. Set the key in `codex-config.json` via `global.personality` or `perModel`.

Advanced path:

1. Use the `personality-builder` skill when you want stricter voice/protocol extraction from source docs.
2. Follow the skill workflow, then persist through `create-personality`.

## Why `runtime.mode` exists (and no `identityMode`)

- `runtime.mode` is the canonical persisted mode setting in `codex-config.json`.
- Identity behavior is derived from mode:
  - `native` -> native identity
  - `codex` -> codex identity
- `spoofMode` is compatibility plumbing, not a canonical config key.

## Environment variables

### Config/mode overrides

- `OPENCODE_OPENAI_MULTI_CONFIG_PATH`: absolute config file path.
- `OPENCODE_OPENAI_MULTI_MODE`: `native|codex`.
- `OPENCODE_OPENAI_MULTI_SPOOF_MODE`: advanced temporary identity override (`native|codex`).
  - If `OPENCODE_OPENAI_MULTI_MODE` is set, runtime mode takes precedence.
- `XDG_CONFIG_HOME`: changes config/agents/personality roots.

### Runtime overrides

- `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH_BUFFER_MS`: integer ms.
- `OPENCODE_OPENAI_MULTI_QUIET`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_PID_OFFSET`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_ROTATION_STRATEGY`: `sticky|hybrid|round_robin`.
- `OPENCODE_OPENAI_MULTI_PERSONALITY`: personality key override.
- `OPENCODE_OPENAI_MULTI_THINKING_SUMMARIES`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_COMPAT_INPUT_SANITIZER`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_REMAP_DEVELOPER_MESSAGES_TO_USER`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_CODEX_COMPACTION_OVERRIDE`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_HEADER_TRANSFORM_DEBUG`: `1|0|true|false`.

### Debug/OAuth controls

- `OPENCODE_OPENAI_MULTI_DEBUG=1`: plugin debug logs.
- `DEBUG_CODEX_PLUGIN=1`: alternate debug flag.
- `CODEX_AUTH_DEBUG=1`: verbose OAuth lifecycle logging (`oauth-lifecycle.log`).
  - Accepted truthy values: `1`, `true`, `yes`, `on`.
  - This flag is independent from general plugin debug flags.
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
