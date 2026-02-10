# Releasing

Use this checklist before shipping.

## Safety rules

- Do not publish unless explicitly intended.
- Do not edit generated `dist/` files manually.
- Always run full verification first.

## Required verification

```bash
npm run verify
```

This runs:

- `npm run typecheck`
- `npm test`
- `npm run build`

## Manual smoke checklist

1. `opencode auth login`
2. Add at least two accounts in one session
3. Check quotas (`5h`, `Weekly`, `Credits` render)
4. Toggle enable/disable for one account
5. Refresh one account token
6. Delete one account, then delete-all (scoped and full)
7. Confirm deleted-all does not auto-repopulate
8. Run one real prompt via `openai/*` model
9. Confirm no malformed tool output in session

## Release notes should include

- User-facing behavior changes
- Auth/storage reliability changes
- Config/mode changes
- Migration/transfer changes
- Verification evidence
