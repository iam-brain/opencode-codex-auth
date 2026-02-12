# Releasing

This document is the source of truth for cutting and validating releases.

## Standard release flow

Cut releases from `main` only:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

These commands route through:

```bash
npm run release -- <patch|minor|major>
```

## What the release script does

`scripts/release.js` enforces and performs the following, in order:

1. Confirms branch is `main`.
2. Confirms working tree is clean.
3. Runs `npm run verify`.
4. Runs `npm version <bump> -m "release: v%s"`.
5. Pushes `main` plus tags (`git push origin main --follow-tags`).
6. If `gh` is installed and authenticated, waits for GitHub Release visibility.

## Required checks before release

Run this locally before any release command:

```bash
npm run verify
```

`verify` runs:

- `npm run typecheck`
- `npm test`
- `npm run build`

Recommended additional checks:

```bash
npm run lint
npm run format:check
```

## Changelog policy

- Keep release-intended changes in `## Unreleased` while developing.
- Immediately before release, move them into the versioned section being cut.
- Keep notes user-facing and behavior-oriented, not implementation-only.

## CI/CD workflows

GitHub Actions handle verification and publish automation:

- `.github/workflows/ci.yml`
  - runs verify checks on pushes and pull requests
- `.github/workflows/release.yml`
  - on `v*` tag push, installs dependencies, runs `npm run verify`, publishes to npm with Trusted Publishing, and creates GitHub Release

## Manual smoke checklist

Run a quick live pass in OpenCode:

1. `opencode auth login`
2. Add at least two accounts in one session
3. Check quotas (`5h`, `Weekly`, `Credits`)
4. Toggle one account enabled/disabled
5. Refresh one account token
6. Delete one account, then delete-all (scoped and full)
7. Confirm delete-all does not immediately repopulate
8. Run one real prompt using an available `openai/*` model
9. Confirm no malformed tool output in session

## One-time setup (maintainer)

1. Create npm package `@iam-brain/opencode-codex-auth` (public).
2. Configure npm Trusted Publishing for `iam-brain/opencode-codex-auth`.
3. Ensure GitHub Actions are enabled for the repo.

## Safety rules

- Do not run release commands unless publishing is intended.
- Do not manually edit generated `dist/` files.
- Prefer script-driven release flow over manual git tagging.
