# Config fields

## Debug

Either of these enables debug logging:

- `OPENCODE_OPENAI_MULTI_DEBUG=1`
- `DEBUG_CODEX_PLUGIN=1`

## Behavior toggles

- `OPENCODE_OPENAI_MULTI_SPOOF_MODE=native|codex`
- `OPENCODE_OPENAI_MULTI_COMPAT_INPUT_SANITIZER=true|false`
- `OPENCODE_OPENAI_MULTI_MODE=native|codex|collab`
- `OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS=true|false`
- `OPENCODE_OPENAI_MULTI_PERSONALITY=<personality-key>`
- `OPENCODE_OPENAI_MULTI_THINKING_SUMMARIES=true|false`
- `OPENCODE_OPENAI_MULTI_QUIET=true|false`
- `OPENCODE_OPENAI_MULTI_PID_OFFSET=true|false`

## Proactive refresh

- `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH=true`
- `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH_BUFFER_MS=<number>`

## Config file

`codex-config.json` is loaded from:

- `OPENCODE_OPENAI_MULTI_CONFIG_PATH` (if set)
- `~/.config/opencode/codex-config.json`

Canonical file layout:

- top level:
  - `debug: boolean`
  - `quiet: boolean`
  - `refreshAhead.enabled: boolean`
  - `refreshAhead.bufferMs: number`
  - `runtime.mode: "native" | "codex" | "collab"`
  - `runtime.identityMode: "native" | "codex"`
  - `mode: "native" | "codex" | "collab"` (alias for `runtime.mode`)
  - `runtime.sanitizeInputs: boolean`
  - `runtime.headerSnapshots: boolean`
  - `runtime.pidOffset: boolean`
- model behavior:
  - `global.personality`, `global.thinkingSummaries`
  - `perModel.<model>.personality`, `perModel.<model>.thinkingSummaries`
  - `perModel.<model>.variants.<variant>.personality`
  - `perModel.<model>.variants.<variant>.thinkingSummaries`

See `lib/config.ts`.
