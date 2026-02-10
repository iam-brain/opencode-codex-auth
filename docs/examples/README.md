# Config Examples

- `opencode.json`: keep this minimal, only plugin installation/enablement.
- `codex-config.json`: plugin runtime behavior flags plus model behavior sections:
  - `global` for all models
  - `perModel` for model-specific overrides
  - `perModel.<model>.variants` for per-variant overrides
