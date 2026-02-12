# Config Internals

Canonical source: `lib/config.ts`.

## Parse and resolve stages

1. `ensureDefaultConfigFile` creates `codex-config.json` when missing.
2. `loadConfigFile` loads and parses file content (with JSON comment stripping).
3. `resolveConfig` overlays environment variables and resolves final runtime config.

## Input normalization

Normalization includes:

- booleans (`1|0|true|false` for most env bools)
- numeric values
- enum-like values (`mode`, `rotationStrategy`)
- personality key sanitization
- model override normalization (`global`, `perModel`, `variants`)

## Precedence rules

Config precedence:

1. environment variables
2. file values
3. defaults

Mode resolution details are implemented in `resolveConfig` and covered in `test/config.test.ts`.

## Compatibility behavior

`loadConfigFile` accepts legacy/non-canonical keys for migration compatibility:

- top-level `personality`
- top-level `customSettings`
- `customSettings` nested model entries

Canonical docs and examples should use `global` and `perModel` keys.

## Integration points

`index.ts` consumes resolved config for:

- runtime mode and spoof mode
- rotation strategy
- proactive refresh scheduler
- request snapshot options
- tool behavior defaults
