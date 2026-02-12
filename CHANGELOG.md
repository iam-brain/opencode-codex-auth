# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- Session affinity and cache-path hardening:
  - Added persistent sticky/hybrid session affinity with deleted-session pruning.
  - Moved plugin cache state to `~/.config/opencode/cache/` (`codex-session-affinity.json`, `codex-snapshots.json`).
  - Excluded subagent sessions from affinity persistence to prevent cache growth.
- Personality workflow expansion:
  - Added managed `personality-builder` skill bundle install/sync.
  - Kept `/create-personality` command + `create-personality` tool as primary user flow.
- OAuth debug gating:
  - Tightened `oauth-lifecycle.log` writes to explicit `CODEX_AUTH_DEBUG` truthy values only.
  - Added regression coverage and docs clarifying flag behavior.

- Account-manager UX hardening:
  - Browser login supports repeated multi-add in one session (`Add new account` returns to menu).
  - `Esc` exits cleanly from auth menu without falling into code-paste mode.
  - `Delete all accounts` is available from both main and per-account menus.
- Storage reliability:
  - `codex-accounts.json` empty state is now authoritative (no immediate legacy reseed after delete-all).
  - Legacy/native transfer remains explicit and conditional on missing `codex-accounts.json`.
- Quota/status parity improvements:
  - `Check quotas` performs live backend fetch and persists snapshots.
  - Status output renders `5h` + `Weekly` bars with inline reset timers and `Credits`.
  - Percentage output is width-3 padded for stable alignment.
- Docs and release guidance:
  - Updated user/developer docs to match current runtime behavior and file layout.
  - Expanded release checklist with manual smoke tests.

## 0.1.0 - 2026-02-05

- Initial release
