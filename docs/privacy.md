# Privacy

## Secrets on disk

OAuth tokens are stored locally in `~/.config/opencode/auth.json`.

- Treat this file like a password file.
- Writes are atomic (temp + rename) with best-effort `0600` permissions.

## Logging

The plugin avoids logging tokens.

Debug logging is gated and must be explicitly enabled.

## Tool output

User-facing tool output strings avoid printing absolute filesystem paths.
