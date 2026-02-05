# Configuration

This plugin is designed to be configured primarily via environment variables.

## Debug logging

Enable debug logs (gated):

- `OPENCODE_OPENAI_AUTH_DEBUG=1`
- `CODEX_AUTH_DEBUG=1`
- `DEBUG_CODEX_PLUGIN=1`

## Proactive refresh (optional)

Disabled by default.

- Enable: `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH=true`
- Buffer: `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH_BUFFER_MS=60000`

## Account storage

OAuth credentials are stored in:

- `~/.config/opencode/auth.json`

Corrupt JSON is quarantined (best-effort) when load options are provided.
