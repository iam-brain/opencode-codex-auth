# Documentation structure

This file describes how docs are organized and maintained.

## Layout

- Root entrypoints:
  - `README.md`
  - `docs/README.md`
  - `docs/index.md` (global docs index + fast agent read order)
- User-facing guides:
  - `docs/getting-started.md`
  - `docs/configuration.md`
  - `docs/multi-account.md`
  - `docs/troubleshooting.md`
  - `docs/privacy.md`
  - `docs/releasing.md`
  - `docs/examples/README.md`
- Developer docs:
  - `docs/development/README.md`
  - `docs/development/ARCHITECTURE.md`
  - `docs/development/CONFIG_FLOW.md`
  - `docs/development/CONFIG_FIELDS.md`
  - `docs/development/TESTING.md`
  - `docs/development/UPSTREAM_SYNC.md`
- Plans/docs-in-progress (when present locally):
  - `docs/plans/`
  - `docs/research/`

## Documentation rules

- Prefer canonical behavior from code over historical behavior.
- Keep config docs aligned with `lib/config.ts`.
- Keep auth/account docs aligned with `lib/storage.ts`, `lib/rotation.ts`, `lib/codex-native.ts`, and `lib/codex-native/*.ts` helper modules.
- Treat token/auth files as sensitive. Never paste raw secrets in docs.
- Canonical docs drift is enforced by `npm run check:docs` (wired into `npm run verify`).

## Local-only workflow directories

`docs/plans/` and `docs/research/` (if present) are local authoring areas and are not part of repository-maintained canonical documentation.
