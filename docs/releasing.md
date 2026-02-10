# Releasing

Use this checklist before creating any production release.

## Safety rules

- Do not run `npm publish` manually.
- Do not run any `release:*` scripts unless explicitly requested.
- Always run `npm run verify` before any release.

## Versioning

- Follow semver.
- Update `CHANGELOG.md` before tagging.

## Build artifacts

- `dist/` is generated.
- Never edit `dist/` by hand.

## Required preflight

Run:

```bash
npm run verify
```

This executes:

- typecheck
- full test suite
- build

## Manual smoke checks (recommended)

Before release, run these in a real OpenCode session:

1. `opencode auth login`
2. Add at least two accounts in one run (`Add new account` should return to menu after success).
3. Run `Check quotas` and verify output includes:
   - `5h` bar with inline reset timer
   - `Weekly` bar with inline reset timer
   - `Credits`
4. Test account actions:
   - enable/disable
   - refresh token
   - delete single account
   - delete all accounts
5. Confirm deleted-all state persists (accounts should not auto-reappear from legacy files).
6. Run one real model call through OpenCode and confirm normal tool usage / no malformed output.

## Release notes content

Include these sections:

- User-facing changes
- Reliability and auth/storage safety changes
- Migration/compat notes (legacy file fallback behavior, config aliases)
- Verification evidence (`npm run verify` + smoke-check summary)
