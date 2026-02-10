# Config flow

Config is resolved in two steps:

1. `loadConfigFile({ env: process.env })`
2. `resolveConfig({ env: process.env, file })`

The implementation is intentionally conservative:

- Environment variables take precedence over file values.
- Defaults are safe (debug off; proactive refresh off).
- Values are validated and normalized (booleans/numbers are parsed and clamped).
- Model behavior resolution precedence is `perModel.<model>.variants.<variant>` -> `perModel.<model>` -> `global`.
- Config file load order:
  - `OPENCODE_OPENAI_MULTI_CONFIG_PATH` (if set)
  - `~/.config/opencode/codex-config.json`

See `lib/config.ts`.
