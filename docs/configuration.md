# Configuration

Canonical implementation source: `lib/config.ts`.

## Config files

- Runtime config: `~/.config/opencode/codex-config.json`
- Plugin registration: `~/.config/opencode/opencode.json`

If `codex-config.json` does not exist, the plugin creates a default file (`ensureDefaultConfigFile` in `lib/config.ts`).

## Schemas

- `schemas/codex-config.schema.json` for `codex-config.json`
- `schemas/opencode.schema.json` for `opencode.json`
- `schemas/codex-accounts.schema.json` for advanced/manual account-store recovery

## Path resolution order

`codex-config.json` load order (`loadConfigFile` in `lib/config.ts`):

1. `OPENCODE_OPENAI_MULTI_CONFIG_PATH`
2. `$XDG_CONFIG_HOME/opencode/codex-config.json`
3. `~/.config/opencode/codex-config.json`

`codex-config.json` accepts JSON comments (`//`, `/* ... */`).

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

Defaults are implemented in `DEFAULT_CODEX_CONFIG` in `lib/config.ts` and validated in `test/config.test.ts`.

## Runtime keys

Top-level:

- `debug: boolean`
- `quiet: boolean`
- `refreshAhead.enabled: boolean`
- `refreshAhead.bufferMs: number`

Runtime section:

- `runtime.mode: "native" | "codex"`
- `runtime.rotationStrategy: "sticky" | "hybrid" | "round_robin"`
- `runtime.sanitizeInputs: boolean`
- `runtime.headerSnapshots: boolean`
- `runtime.headerTransformDebug: boolean`
- `runtime.pidOffset: boolean`

Model behavior:

- `global.personality: string`
- `global.thinkingSummaries: boolean`
- `perModel.<model>.personality: string`
- `perModel.<model>.thinkingSummaries: boolean`
- `perModel.<model>.variants.<variant>.personality: string`
- `perModel.<model>.variants.<variant>.thinkingSummaries: boolean`

## Model behavior precedence

Precedence for `personality` and `thinkingSummaries`:

1. `perModel.<model>.variants.<variant>`
2. `perModel.<model>`
3. `global`

Implementation: `resolvePersonalityForModel` and `getModelThinkingSummariesOverride` in `lib/codex-native/request-transform.ts`.

## Environment variables

Config and mode:

- `OPENCODE_OPENAI_MULTI_CONFIG_PATH`
- `OPENCODE_OPENAI_MULTI_MODE` (`native|codex`)
- `OPENCODE_OPENAI_MULTI_SPOOF_MODE` (`native|codex`, compatibility path)
- `XDG_CONFIG_HOME`

Runtime overrides:

- `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH`
- `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH_BUFFER_MS`
- `OPENCODE_OPENAI_MULTI_QUIET`
- `OPENCODE_OPENAI_MULTI_PID_OFFSET`
- `OPENCODE_OPENAI_MULTI_ROTATION_STRATEGY`
- `OPENCODE_OPENAI_MULTI_PERSONALITY`
- `OPENCODE_OPENAI_MULTI_THINKING_SUMMARIES`
- `OPENCODE_OPENAI_MULTI_COMPAT_INPUT_SANITIZER`
- `OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS`
- `OPENCODE_OPENAI_MULTI_HEADER_TRANSFORM_DEBUG`

OAuth/debug:

- `OPENCODE_OPENAI_MULTI_DEBUG=1`
- `DEBUG_CODEX_PLUGIN=1`
- `CODEX_AUTH_DEBUG=1|true|yes|on`
- `CODEX_OAUTH_CALLBACK_TIMEOUT_MS` (minimum `60000`)
- `CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS`
- `CODEX_OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS`
- `OPENCODE_NO_BROWSER=1`
- `NO_COLOR=1`

Sources: `lib/config.ts`, `lib/codex-native.ts`, `lib/codex-native/oauth-server.ts`.

## Source precedence

Overall precedence in `resolveConfig` (`lib/config.ts`):

1. Environment variables
2. Config file values
3. Built-in defaults

Coverage: `test/config.test.ts`.

## Compatibility keys

The parser accepts legacy keys for migration compatibility, but they are non-canonical for new edits:

- top-level `personality`
- top-level `customSettings`
- `customSettings.thinkingSummaries`
- `customSettings.options.personality`
- `customSettings.models`

Use canonical `global` and `perModel` keys for all new configuration.
