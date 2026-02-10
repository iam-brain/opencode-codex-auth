# Privacy

## Secrets on disk

OAuth data is stored locally in:

- `~/.config/opencode/codex-accounts.json` (plugin multi-account store)
- `~/.local/share/opencode/auth.json` (OpenCode provider auth state)

- Treat both files like password files.
- Writes are atomic (temp + rename) with best-effort `0600` permissions.

## Logging

The plugin avoids logging tokens.

Debug logging is gated and must be explicitly enabled.

## Tool output

User-facing tool output strings avoid printing absolute filesystem paths.
