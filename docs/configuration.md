# Configuration

The plugin supports both JSON config files and environment variables.

## Config file locations

The plugin reads `codex-config.json` from:

- `OPENCODE_OPENAI_MULTI_CONFIG_PATH` (or `CODEX_AUTH_CONFIG_PATH`) if set
- `~/.config/opencode/codex-config.json`
- legacy fallback: `~/.config/opencode/openai-codex-auth-config.json`
- legacy fallback: `~/.opencode/codex-config.json`
- legacy fallback: `~/.opencode/openai-codex-auth-config.json`

## OpenCode config split

Keep `opencode.json` minimal and only use it to enable this plugin:

```json
{
  "plugin": ["file:///absolute/path/to/opencode-openai-multi/dist"]
}
```

Put plugin behavior flags in `~/.config/opencode/codex-config.json`:

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
    "identityMode": "native",
    "sanitizeInputs": false,
    "headerSnapshots": false
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
          "personality": "strict",
          "thinkingSummaries": true
        }
      }
    }
  }
}
```

`global` and `perModel.<model>` accept the same model behavior fields:

- `personality`
- `thinkingSummaries`

`perModel.<model>.variants.<variant>` accepts the same behavior fields as `global` and `perModel.<model>`.
Variant overrides apply before per-model and global values.

The parser also accepts legacy/compat keys for existing installs:

- `authDebug` (alias for `debug`)
- `quietMode` (alias for `quiet`)
- `proactiveRefresh` / `proactiveTokenRefresh` (map to `refreshAhead.enabled`)
- `proactiveRefreshBufferMs` / `tokenRefreshSkewMs` (map to `refreshAhead.bufferMs`)
- `spoofMode` / `codexSpoofMode` (map to `runtime.identityMode`)
- `mode` / `runtime.mode` (runtime mode: `native|codex|collab`)
- `compatInputSanitizer` / `compat.inputSanitizer` (map to `runtime.sanitizeInputs`)
- `runtime.headerSnapshots` and `telemetry.requestShapeDebug` / `telemetry.headerSnapshots` (map to request snapshot logging)
- `custom_settings` / `customSettings` with `thinking_summaries` / `thinkingSummaries`
- `perModel.<model>.perVariant` (alias for `perModel.<model>.variants`)

## Debug logging

Enable debug logs (gated):

- `OPENCODE_OPENAI_AUTH_DEBUG=1`
- `CODEX_AUTH_DEBUG=1`
- `DEBUG_CODEX_PLUGIN=1`

## Runtime behavior flags

- Spoof mode:
  - `OPENCODE_OPENAI_MULTI_SPOOF_MODE=native` (default)
  - `OPENCODE_OPENAI_MULTI_SPOOF_MODE=codex`
  - alias: `CODEX_AUTH_SPOOF_MODE=native|codex`
  - backward-compatible aliases: `standard -> native`, `strict -> codex`
  - `native`: legacy-plugin-style headers (`originator=codex_cli_rs`, `OpenAI-Beta=responses=experimental`, `conversation_id/session_id=<promptCacheKey>` when present)
  - `codex`: codex-rs-style headers (`originator=codex_cli_rs`, `session_id=<promptCacheKey|sessionID>`, no `OpenAI-Beta` or `conversation_id`)
- Runtime mode:
  - `mode` / `runtime.mode`: `native` (default), `codex`, `collab`
  - env: `OPENCODE_OPENAI_MULTI_MODE` (alias `CODEX_AUTH_MODE`)
  - `collab` is required for Codex collaboration profile/header injection; `native` and `codex` do not inject collaboration behavior.
  - `collab` is currently **WIP / untested** and is not recommended for production usage yet.
- Compatibility sanitizer (default off):
  - `OPENCODE_OPENAI_MULTI_COMPAT_INPUT_SANITIZER=true`
- Compaction prompt behavior:
  - For OpenAI-provider sessions, the plugin replaces OpenCode's default compaction prompt with the codex-rs compact prompt.
- Review behavior:
  - For OpenAI-provider sessions, `/review` subtasks are rewritten to run with `Codex Review` agent instructions.
- Request/response header snapshots (default off):
  - `OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS=true`
  - compatibility alias: `ENABLE_PLUGIN_REQUEST_LOGGING=1`
  - output path: `~/.config/opencode/logs/codex-plugin/`
  - captures staged files such as `request-*-before-auth.json`, `request-*-after-sanitize.json`, `request-*-orchestrator-attempt-*.json`, and matching `response-*` files
  - appends a rolling request-header stream to `live-headers.jsonl` in the same directory
  - sensitive auth headers/tokens are redacted before write
- Personality override:
  - `OPENCODE_OPENAI_MULTI_PERSONALITY=friendly` (or another safe key)
- Thinking summaries override:
  - `OPENCODE_OPENAI_MULTI_THINKING_SUMMARIES=true|false`
  - alias: `CODEX_AUTH_THINKING_SUMMARIES=true|false`
- Quiet mode:
  - `OPENCODE_OPENAI_MULTI_QUIET=true`
  - alias: `CODEX_AUTH_QUIET=true`

Boolean env values accept `true/false` or `1/0`.

## Proactive refresh (optional)

Disabled by default.

- Enable: `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH=true`
- Buffer: `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH_BUFFER_MS=60000`

## Account files

OpenCode and this plugin use two related auth files:

- OpenCode OAuth marker (provider auth): `~/.local/share/opencode/auth.json`
- Plugin multi-account store (rotation + cooldowns): `~/.config/opencode/codex-accounts.json`

Legacy account-file fallbacks are supported during migration:

- `~/.config/opencode/openai-codex-accounts.json`
- `~/.config/opencode/auth.json`
- `~/.local/share/opencode/auth.json` (OpenCode provider marker fallback path)

The plugin can quarantine corrupt multi-account JSON (bounded retention) when load options are provided.

## Account migration behavior

- If `codex-accounts.json` is missing, the plugin may bootstrap from legacy/native auth files.
- If `codex-accounts.json` exists (including `accounts: []`), that file is authoritative.
- The interactive `Transfer OpenAI accounts from native & old plugins?` option appears only when:
  - `codex-accounts.json` is missing, and
  - a legacy/native source exists.
