# Troubleshooting

## OAuth callback issues

Browser OAuth uses a local callback server on `http://localhost:1455/auth/callback`.

If the port is already in use, stop other Codex/OpenCode auth flows and retry.

## Corrupt auth.json

If `~/.config/opencode/auth.json` becomes corrupt JSON, the storage layer can quarantine the file (bounded retention) and return an empty storage object.

## Rate limits

On `429` responses, the plugin parses `Retry-After`, persists a per-account cooldown, and retries with another enabled account when possible.

## Debug logs

Enable debug logs with `OPENCODE_OPENAI_AUTH_DEBUG=1`.
