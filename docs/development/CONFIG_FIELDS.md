# Config fields

## Debug

Any of these enable debug logging:

- `CODEX_AUTH_DEBUG=1`
- `OPENCODE_OPENAI_AUTH_DEBUG=1`
- `DEBUG_CODEX_PLUGIN=1`

## Behavior toggles

- `OPENCODE_OPENAI_MULTI_SPOOF_MODE=native|codex`
- `CODEX_AUTH_SPOOF_MODE=native|codex` (alias)
  - backward-compatible aliases are still accepted:
    - `standard -> native`
    - `strict -> codex`
- `OPENCODE_OPENAI_MULTI_COMPAT_INPUT_SANITIZER=true|false`
- `OPENCODE_OPENAI_MULTI_MODE=native|codex|collab`
- `CODEX_AUTH_MODE=native|codex|collab` (alias)
- `OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS=true|false`
- `ENABLE_PLUGIN_REQUEST_LOGGING=1|0` (compat alias for header snapshots)
- `OPENCODE_OPENAI_MULTI_PERSONALITY=<personality-key>`
- `OPENCODE_OPENAI_MULTI_THINKING_SUMMARIES=true|false`
- `CODEX_AUTH_THINKING_SUMMARIES=true|false` (alias)
- `OPENCODE_OPENAI_MULTI_QUIET=true|false`
- `CODEX_AUTH_QUIET=true|false` (alias)

## Proactive refresh

- `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH=true`
- `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH_BUFFER_MS=<number>`

## Config file

`codex-config.json` is loaded from:

- `OPENCODE_OPENAI_MULTI_CONFIG_PATH` / `CODEX_AUTH_CONFIG_PATH` (if set)
- `~/.config/opencode/codex-config.json`
- legacy `~/.config/opencode/openai-codex-auth-config.json`
- legacy `~/.opencode/codex-config.json`
- legacy `~/.opencode/openai-codex-auth-config.json`

Canonical file layout:

- top level:
  - `debug: boolean`
  - `quiet: boolean`
  - `refreshAhead.enabled: boolean`
  - `refreshAhead.bufferMs: number`
  - `runtime.mode: "native" | "codex" | "collab"` (aliases: `standard`, `strict`, `collaboration`)
  - `runtime.identityMode: "native" | "codex"` (aliases: `standard`, `strict`)
  - `mode: "native" | "codex" | "collab"` (alias for `runtime.mode`)
  - `runtime.sanitizeInputs: boolean`
  - `runtime.headerSnapshots: boolean`
- model behavior:
  - `global.personality`, `global.thinkingSummaries`
  - `perModel.<model>.personality`, `perModel.<model>.thinkingSummaries`
  - `perModel.<model>.variants.<variant>.personality`
  - `perModel.<model>.variants.<variant>.thinkingSummaries`

Accepted file key aliases (backward compatibility):

- `debug`: also accepts `authDebug`
- `quiet`: also accepts `quietMode`
- `refreshAhead.enabled`: also accepts `proactiveRefresh` and `proactiveTokenRefresh`
- `refreshAhead.bufferMs`: also accepts `proactiveRefreshBufferMs` and `tokenRefreshSkewMs`
- `runtime.identityMode`: also accepts `spoofMode` and `codexSpoofMode`
- `runtime.sanitizeInputs`: also accepts `compatInputSanitizer` and `compat.inputSanitizer`
- `custom_settings`: also accepts `customSettings`
- `thinking_summaries`: also accepts `thinkingSummaries`
- `perModel.<model>.variants`: also accepts `perModel.<model>.perVariant`

See `lib/config.ts`.
