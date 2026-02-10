# Releasing

Use this checklist before shipping.

## Release commands

Use one of these to cut a release from `main`:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

Each command:

1. Runs tests (`npm test`)
2. Bumps `package.json` version and creates a release commit + `v*` tag
3. Builds artifacts
4. Pushes `main` with tags

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

## CI/CD automation

The repo uses old-plugin-style workflows:

- `.github/workflows/ci.yml`:
  - runs typecheck/test/build on pushes and PRs
- `.github/workflows/tag-version.yml`:
  - ensures a `v<package.json version>` tag exists when version changes on `main`
- `.github/workflows/release.yml`:
  - on `v*` tag push, runs tests/build, publishes to npm via OIDC Trusted Publishing, and creates a GitHub Release

## One-time setup

1. Create npm package `@iam-brain/opencode-codex-auth` (public)
2. In npm Trusted Publishing, connect `iam-brain/opencode-codex-auth` GitHub repo/workflow
3. Ensure GitHub Actions are enabled for the repo

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
