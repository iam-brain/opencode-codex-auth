# Config flow

Config resolution has two stages.

## Stage 0: ensure default file

`ensureDefaultConfigFile({ env: process.env })`

- creates `~/.config/opencode/codex-config.json` when missing
- seeds canonical defaults for runtime + behavior sections

## Stage 1: file load

`loadConfigFile({ env: process.env })`

- reads from `OPENCODE_OPENAI_MULTI_CONFIG_PATH` if present
- otherwise reads `~/.config/opencode/codex-config.json`
- parses canonical fields into `PluginConfig` partial

## Stage 2: runtime resolve

`resolveConfig({ env: process.env, file })`

- overlays env variables on file values
- normalizes booleans/numbers/enum-like values
- resolves runtime mode + spoof mode defaults
- merges custom settings (`global`/`perModel`/`variants`)

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
- reconcile collab agent file state
- initialize proactive refresh scheduler
- pass runtime options into `CodexAuthPlugin`
