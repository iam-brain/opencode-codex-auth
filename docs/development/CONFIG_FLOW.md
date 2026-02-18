# Config flow

Config resolution has three stages.

## Stage 0: ensure default file

`ensureDefaultConfigFile({ env: process.env })`

- creates default config path when missing:
  - `$XDG_CONFIG_HOME/opencode/codex-config.json` when `XDG_CONFIG_HOME` is set
  - otherwise `~/.config/opencode/codex-config.json`
- seeds canonical defaults for runtime + behavior sections

## Stage 1: file load

`loadConfigFile({ env: process.env })`

- reads from `OPENCODE_OPENAI_MULTI_CONFIG_PATH` if present
- otherwise reads default config path (`$XDG_CONFIG_HOME/opencode/codex-config.json` or `~/.config/opencode/codex-config.json`)
- parses canonical fields into `PluginConfig` partial
- if known fields are invalid, ignores the config file and warns (env/defaults still apply)

## Stage 2: runtime resolve

`resolveConfig({ env: process.env, file })`

- overlays env variables on file values
- normalizes booleans/numbers/enum-like values
- resolves runtime mode as canonical (`env runtime.mode` -> `file runtime.mode` -> spoof compatibility fallback)
- derives spoof mode from runtime mode when mode is explicit; uses spoof compatibility input only when mode is unset
- resolves prompt-cache-key strategy (`default` or `project`)
- resolves behavior settings (`global`/`perModel`/`variants`)

## Behavior precedence

For model behavior:

1. `perModel.<model>.variants.<variant>`
2. `perModel.<model>`
3. `global`

For config sources:

1. environment
2. config file
3. defaults

## Startup consumers

`index.ts` consumes resolved config to:

- ensure `/create-personality` command template exists
- initialize proactive refresh scheduler
- pass runtime options into `CodexAuthPlugin`
