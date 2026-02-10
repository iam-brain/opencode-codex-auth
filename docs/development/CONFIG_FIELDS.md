# Config fields reference

Canonical source: `lib/config.ts`

## File location

- `OPENCODE_OPENAI_MULTI_CONFIG_PATH`
- fallback: `~/.config/opencode/codex-config.json`

## Canonical JSON keys

Top-level:

- `debug: boolean`
- `quiet: boolean`
- `refreshAhead.enabled: boolean`
- `refreshAhead.bufferMs: number`
- `runtime.mode: "native" | "codex" | "collab"`
- `runtime.identityMode: "native" | "codex"`
- `runtime.sanitizeInputs: boolean`
- `runtime.headerSnapshots: boolean`
- `runtime.pidOffset: boolean`
- `mode: "native" | "codex" | "collab"` (alias for runtime mode)
- `global.personality: string`
- `global.thinkingSummaries: boolean`
- `perModel.<model>.personality: string`
- `perModel.<model>.thinkingSummaries: boolean`
- `perModel.<model>.variants.<variant>.personality: string`
- `perModel.<model>.variants.<variant>.thinkingSummaries: boolean`

## Environment variables

Core:

- `OPENCODE_OPENAI_MULTI_MODE`
- `OPENCODE_OPENAI_MULTI_SPOOF_MODE`
- `OPENCODE_OPENAI_MULTI_CONFIG_PATH`

Behavior + debug:

- `OPENCODE_OPENAI_MULTI_DEBUG`
- `DEBUG_CODEX_PLUGIN`
- `OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS`
- `OPENCODE_OPENAI_MULTI_COMPAT_INPUT_SANITIZER`
- `OPENCODE_OPENAI_MULTI_QUIET`
- `OPENCODE_OPENAI_MULTI_PID_OFFSET`
- `OPENCODE_OPENAI_MULTI_PERSONALITY`
- `OPENCODE_OPENAI_MULTI_THINKING_SUMMARIES`

Proactive refresh:

- `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH`
- `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH_BUFFER_MS`

## Precedence and defaults

- Env overrides file values.
- `mode` defaults to:
  - explicit env/file mode when set
  - otherwise inferred from spoof mode (`codex` => `codex`, else `native`)
- `spoofMode` defaults to:
  - env/file spoof mode when set
  - otherwise derived from mode (`native` => `native`, else `codex`)
- proactive refresh buffer defaults to `60000` when unset.
