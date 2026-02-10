# Configuration

The plugin uses one canonical config file plus environment overrides.

## Config file location

Resolved in this order:

1. `OPENCODE_OPENAI_MULTI_CONFIG_PATH`
2. `~/.config/opencode/codex-config.json`

If the file is missing, the plugin creates a fresh default `codex-config.json` automatically.

## Recommended config shape

```json
{
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
    "personality": "friendly",
    "thinkingSummaries": true
  },
  "perModel": {
    "gpt-5.3-codex": {
      "personality": "pragmatic",
      "thinkingSummaries": false,
      "variants": {
        "high": {
          "personality": "focused",
          "thinkingSummaries": true
        }
      }
    }
  }
}
```

## Runtime modes

- `runtime.mode`
- Allowed values: `native`, `codex`, `collab`

Behavior:

- `native`: native-plugin request identity defaults
- `codex`: codex-rs-like request identity defaults
- `collab`: collaboration profile injection for Codex agents (WIP / untested)
- Identity mode is inferred automatically:
  - `native` -> native identity
  - `codex|collab` -> codex identity

Collab agent file reconciliation at startup:

- `collab`: `Codex *.md` active
- `native|codex`: `Codex *.md.disabled`

## Model behavior precedence

For personality and thinking summaries:

1. `perModel.<model>.variants.<variant>`
2. `perModel.<model>`
3. `global`

## Environment variables

### Core

- `OPENCODE_OPENAI_MULTI_MODE=native|codex|collab`
- `OPENCODE_OPENAI_MULTI_CONFIG_PATH=/path/to/codex-config.json`
- `OPENCODE_OPENAI_MULTI_SPOOF_MODE=native|codex` (advanced override)

### Debug + snapshots

- `OPENCODE_OPENAI_MULTI_DEBUG=1`
- `DEBUG_CODEX_PLUGIN=1`
- `OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS=true|false`

### Runtime toggles

- `OPENCODE_OPENAI_MULTI_COMPAT_INPUT_SANITIZER=true|false`
- `OPENCODE_OPENAI_MULTI_QUIET=true|false`
- `OPENCODE_OPENAI_MULTI_PID_OFFSET=true|false`

### Proactive refresh

- `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH=true|false`
- `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH_BUFFER_MS=<number>`

### Behavior overrides

- `OPENCODE_OPENAI_MULTI_PERSONALITY=<key>`
- `OPENCODE_OPENAI_MULTI_THINKING_SUMMARIES=true|false`

## Canonical keys only

Supported file keys are canonical only:

- top-level: `debug`, `quiet`, `refreshAhead`, `runtime`, `global`, `perModel`
- runtime: `mode`, `sanitizeInputs`, `headerSnapshots`, `pidOffset`
- model settings: `personality`, `thinkingSummaries`, `variants`

Legacy compatibility keys are still parsed where applicable, but they are not part of the canonical config shape.

## JSON schemas

Schemas are published in this repository:

- `schemas/codex-config.schema.json`
- `schemas/opencode.schema.json`

Use them for validation and editor autocomplete when editing:

- `~/.config/opencode/codex-config.json`
- `~/.config/opencode/opencode.json`

## Auth/account files

- Provider marker: `~/.local/share/opencode/auth.json`
- Plugin store: `~/.config/opencode/codex-accounts.json`

Legacy data is imported explicitly from auth menu transfer, not auto-loaded on normal reads.
