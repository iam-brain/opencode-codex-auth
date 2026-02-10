# Examples

This directory contains starter config files.

## Files

- `opencode.json`
  - minimal plugin registration example (published install)
- `codex-config.json`
  - runtime and model behavior example

## Usage

1. Keep `opencode.json` minimal (plugin enablement only).
2. Put runtime behavior in `~/.config/opencode/codex-config.json`.
3. Customize:
   - `runtime.mode` (`native`, `codex`, `collab`)
   - `global` personality/summaries
   - `perModel` and `variants`
4. Validate with schemas:
   - `schemas/codex-config.schema.json`
   - `schemas/opencode.schema.json`

## Local development

For local development, you can use a file plugin path instead of a package specifier:

```json
{
  "plugin": ["file:///absolute/path/to/opencode-codex-auth/dist"]
}
```
