# Configuration

The plugin supports both JSON config files and environment variables.

## Config file locations

The plugin reads `codex-config.json` from:

- `OPENCODE_OPENAI_MULTI_CONFIG_PATH` if set
- `~/.config/opencode/codex-config.json`

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
          "personality": "focused",
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

Canonical file keys only:

- `debug`, `quiet`
- `refreshAhead.enabled`, `refreshAhead.bufferMs`
- `runtime.mode`, `runtime.identityMode`, `runtime.sanitizeInputs`, `runtime.headerSnapshots`, `runtime.pidOffset`
- `mode` (top-level alias for `runtime.mode`)
- `global`
- `perModel.<model>`
- `perModel.<model>.variants.<variant>`

## Debug logging

Enable debug logs (gated):

- `OPENCODE_OPENAI_MULTI_DEBUG=1`
- `DEBUG_CODEX_PLUGIN=1`

## Runtime behavior flags

- Spoof mode:
  - `OPENCODE_OPENAI_MULTI_SPOOF_MODE=native` (default)
  - `OPENCODE_OPENAI_MULTI_SPOOF_MODE=codex`
  - `native`: legacy-plugin-style headers (`originator=codex_cli_rs`, `OpenAI-Beta=responses=experimental`, `conversation_id/session_id=<promptCacheKey>` when present)
  - `codex`: codex-rs-style headers (`originator=codex_cli_rs`, `session_id=<promptCacheKey|sessionID>`, no `OpenAI-Beta` or `conversation_id`)
- Runtime mode:
  - `mode` / `runtime.mode`: `native` (default), `codex`, `collab`
  - env: `OPENCODE_OPENAI_MULTI_MODE`
  - `collab` is required for Codex collaboration profile/header injection; `native` and `codex` do not inject collaboration behavior.
  - collab agent files are reconciled on startup:
    - `collab`: `Codex *.md` active
    - `native|codex`: `Codex *.md.disabled` (auto-disabled)
  - `collab` is currently **WIP / untested** and is not recommended for production usage yet.
- Compatibility sanitizer (default off):
  - `OPENCODE_OPENAI_MULTI_COMPAT_INPUT_SANITIZER=true`
- Compaction prompt behavior:
  - For OpenAI-provider sessions, the plugin replaces OpenCode's default compaction prompt with the codex-rs compact prompt.
- Review behavior:
  - For OpenAI-provider sessions, `/review` subtasks are rewritten to run with `Codex Review` agent instructions.
- Request/response header snapshots (default off):
  - `OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS=true`
  - output path: `~/.config/opencode/logs/codex-plugin/`
  - captures staged files such as `request-*-before-auth.json`, `request-*-after-sanitize.json`, `request-*-orchestrator-attempt-*.json`, and matching `response-*` files
  - appends a rolling request-header stream to `live-headers.jsonl` in the same directory
  - sensitive auth headers/tokens are redacted before write
- Personality override:
  - `OPENCODE_OPENAI_MULTI_PERSONALITY=friendly` (or another safe key)
- Thinking summaries override:
  - `OPENCODE_OPENAI_MULTI_THINKING_SUMMARIES=true|false`
- Quiet mode:
  - `OPENCODE_OPENAI_MULTI_QUIET=true`

Boolean env values accept `true/false` or `1/0`.

## Proactive refresh (optional)

Disabled by default.

- Enable: `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH=true`
- Buffer: `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH_BUFFER_MS=60000`

## Account files

OpenCode and this plugin use two related auth files:

- OpenCode OAuth marker (provider auth): `~/.local/share/opencode/auth.json`
- Plugin multi-account store (rotation + cooldowns): `~/.config/opencode/codex-accounts.json`

Legacy import sources:

- `~/.config/opencode/openai-codex-accounts.json`
- `~/.local/share/opencode/auth.json` (OpenCode provider marker)

The plugin can quarantine corrupt multi-account JSON (bounded retention) when load options are provided.

## Account migration behavior

- The plugin does not auto-bootstrap from legacy files during normal load.
- Use `opencode auth login` and select `Transfer OpenAI accounts from native & old plugins?` for explicit import.
- If `codex-accounts.json` exists (including `accounts: []`), that file is authoritative.
- The interactive `Transfer OpenAI accounts from native & old plugins?` option appears only when:
  - `codex-accounts.json` is missing, and
  - a legacy/native source exists.
