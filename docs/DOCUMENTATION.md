# Documentation structure

This file describes how docs are organized and maintained.

## Layout

- Root entrypoints:
  - `README.md`
  - `docs/README.md`
  - `docs/index.md`
- User-facing guides:
  - `docs/getting-started.md`
  - `docs/configuration.md`
  - `docs/multi-account.md`
  - `docs/troubleshooting.md`
  - `docs/privacy.md`
  - `docs/releasing.md`
  - `docs/examples/README.md`
- Developer docs:
  - `docs/development/ARCHITECTURE.md`
  - `docs/development/CONFIG_FLOW.md`
  - `docs/development/CONFIG_FIELDS.md`
  - `docs/development/TESTING.md`

## Documentation rules

- Prefer canonical behavior from code over historical behavior.
- Keep config docs aligned with `lib/config.ts`.
- Keep auth/account docs aligned with `lib/storage.ts`, `lib/rotation.ts`, and `lib/codex-native.ts`.
- Treat token/auth files as sensitive. Never paste raw secrets in docs.

## Local-only workflow directories

`docs/plans/` and `docs/research/` are local authoring areas and may be managed as separate git history from the plugin codebase.
