# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

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
