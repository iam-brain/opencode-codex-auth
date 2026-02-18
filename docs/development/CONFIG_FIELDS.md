# Config fields reference

Canonical source: `lib/config.ts`

## File location

- `OPENCODE_OPENAI_MULTI_CONFIG_PATH`
- fallback: `$XDG_CONFIG_HOME/opencode/codex-config.json`
- fallback (no `XDG_CONFIG_HOME`): `~/.config/opencode/codex-config.json`
- parser accepts JSON with comments (`//`, `/* ... */`)

## Canonical JSON keys

Top-level:

- `debug: boolean`
- `quiet: boolean`
- `refreshAhead.enabled: boolean`
- `refreshAhead.bufferMs: number`
- `runtime.mode: "native" | "codex"`
- `runtime.rotationStrategy: "sticky" | "hybrid" | "round_robin"`
- `runtime.sanitizeInputs: boolean`
- `runtime.developerMessagesToUser: boolean`
- `runtime.promptCacheKeyStrategy: "default" | "project"`
- `runtime.codexCompactionOverride: boolean`
- `runtime.headerSnapshots: boolean`
- `runtime.headerSnapshotBodies: boolean`
- `runtime.headerTransformDebug: boolean`
- `runtime.pidOffset: boolean`
- `runtime.collaborationProfile: boolean`
- `runtime.orchestratorSubagents: boolean`
- `global.personality: string`
- `global.thinkingSummaries: boolean`
- `global.verbosityEnabled: boolean`
- `global.verbosity: "default" | "low" | "medium" | "high"`
- `perModel.<model>.personality: string`
- `perModel.<model>.thinkingSummaries: boolean`
- `perModel.<model>.verbosityEnabled: boolean`
- `perModel.<model>.verbosity: "default" | "low" | "medium" | "high"`
- `perModel.<model>.variants.<variant>.personality: string`
- `perModel.<model>.variants.<variant>.thinkingSummaries: boolean`
- `perModel.<model>.variants.<variant>.verbosityEnabled: boolean`
- `perModel.<model>.variants.<variant>.verbosity: "default" | "low" | "medium" | "high"`

Canonical user-edited file set:

- `~/.config/opencode/opencode.json` (plugin registration)
- `~/.config/opencode/codex-config.json` (runtime behavior)
- `~/.config/opencode/codex-accounts.json` (advanced/manual recovery only)
- `.opencode/personalities/*.md` or `~/.config/opencode/personalities/*.md` (custom personalities)

Default generated values:

- `debug: false`
- `quiet: false`
- `refreshAhead.enabled: true`
- `refreshAhead.bufferMs: 60000`
- `runtime.mode: "native"`
- `runtime.rotationStrategy: "sticky"`
- `runtime.sanitizeInputs: false`
- `runtime.developerMessagesToUser: true`
- `runtime.promptCacheKeyStrategy: "default"`
- `runtime.codexCompactionOverride`: mode-derived when unset (`true` in `codex`, `false` in `native`)
- `runtime.headerSnapshots: false`
- `runtime.headerTransformDebug: false`
- `runtime.pidOffset: false`
- `runtime.collaborationProfile`: mode-derived when unset (`true` in `codex`, `false` in `native`)
- `runtime.orchestratorSubagents`: inherits `runtime.collaborationProfile` effective value when unset
- `global.personality: "pragmatic"`
- `global.verbosityEnabled: true`
- `global.verbosity: "default"`
- `perModel: {}`

## Legacy compatibility keys

Legacy behavior keys are not parsed anymore:

- top-level `personality`
- top-level `customSettings`
- any nested `customSettings.*`

Note:

- `runtime.mode` is canonical.
- Identity behavior is derived automatically:
  - `native` => native identity
  - `codex` => codex identity

## Environment variables

Resolved by `resolveConfig`:

- `OPENCODE_OPENAI_MULTI_MODE`
- `OPENCODE_OPENAI_MULTI_SPOOF_MODE`
- `OPENCODE_OPENAI_MULTI_CONFIG_PATH`
- `OPENCODE_OPENAI_MULTI_DEBUG`
- `DEBUG_CODEX_PLUGIN`
- `OPENCODE_OPENAI_MULTI_COMPAT_INPUT_SANITIZER`
- `OPENCODE_OPENAI_MULTI_REMAP_DEVELOPER_MESSAGES_TO_USER`
- `OPENCODE_OPENAI_MULTI_CODEX_COMPACTION_OVERRIDE`
- `OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS`
- `OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOT_BODIES`
- `OPENCODE_OPENAI_MULTI_HEADER_TRANSFORM_DEBUG`
- `OPENCODE_OPENAI_MULTI_QUIET`
- `OPENCODE_OPENAI_MULTI_PID_OFFSET`
- `OPENCODE_OPENAI_MULTI_ROTATION_STRATEGY`
- `OPENCODE_OPENAI_MULTI_PROMPT_CACHE_KEY_STRATEGY`
- `OPENCODE_OPENAI_MULTI_PERSONALITY`
- `OPENCODE_OPENAI_MULTI_THINKING_SUMMARIES`
- `OPENCODE_OPENAI_MULTI_VERBOSITY_ENABLED`
- `OPENCODE_OPENAI_MULTI_VERBOSITY`
- `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH`
- `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH_BUFFER_MS`
- `OPENCODE_OPENAI_MULTI_COLLABORATION_PROFILE`
- `OPENCODE_OPENAI_MULTI_ORCHESTRATOR_SUBAGENTS`

Resolved by auth/runtime code (`lib/codex-native.ts` + helper modules under `lib/codex-native/`):

- `CODEX_AUTH_DEBUG`
- `CODEX_AUTH_DEBUG_MAX_BYTES`
- `CODEX_OAUTH_CALLBACK_TIMEOUT_MS`
- `CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS`
- `CODEX_OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS`
- `CODEX_OAUTH_HTTP_TIMEOUT_MS`
- `CODEX_DEVICE_AUTH_TIMEOUT_MS`
- `OPENCODE_NO_BROWSER`

Path and UI variables used by helpers:

- `XDG_CONFIG_HOME`
- `NO_COLOR`

## Precedence and defaults

- Env overrides file values.
- `mode` defaults to:
  - explicit env mode when set
  - explicit file `runtime.mode` when set
  - otherwise inferred from spoof mode (`codex` => `codex`, else `native`)
- `spoofMode` defaults to:
  - env spoof mode when set
  - otherwise derived from mode (`native` => `native`, else `codex`)
- proactive refresh buffer defaults to `60000` when unset.

## Parsing rules

- Boolean env parser accepts only `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_DEBUG` and `DEBUG_CODEX_PLUGIN` enable debug only when equal to `1`.
- `CODEX_OAUTH_CALLBACK_TIMEOUT_MS` values below `60000` are ignored.
- Grace timeout envs (`CODEX_OAUTH_SERVER_SHUTDOWN_*`) must be numeric and `>= 0`.
