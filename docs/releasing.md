# Releasing

This document is the source of truth for cutting and validating releases.

## Standard release flow

Cut releases from the repository default branch only (typically `main`):

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

1. Resolves and confirms branch is the repository default branch.
2. Confirms working tree is clean.
3. Confirms `HEAD` matches `origin/<default-branch>`.
4. Confirms latest `ci.yml` push run for `HEAD` is green and required jobs succeeded.
5. Runs `npm run verify`.
6. Runs `npm version <bump> -m "release: v%s"`.
7. Pushes default branch plus tags (`git push origin <default-branch> --follow-tags`).
8. Waits for GitHub Release visibility.

Remote CI gate notes:

- Requires authenticated `gh` CLI.
- Override only for emergency/manual recovery with `RELEASE_SKIP_REMOTE_CI_GATE=1`.

Failure behavior:

- If the GitHub release workflow fails after the tag is pushed, the script may auto-rollback by reverting the tagged commit on the default branch and deleting the remote tag.
- Auto-rollback is skipped when npm publish already succeeded, publish status is unknown, or the failure happened before the release-workflow phase.

## Required checks before release

Run this locally before any release command:

```bash
npm run verify
```

`verify` runs:

- `npm run check:esm-imports`
- `npm run lint`
- `npm run format:check`
- `npm run typecheck`
- `npm run typecheck:test`
- `npm run test:anti-mock`
- `npm run test:coverage`
- `npm run check:coverage-ratchet`
- `npm run check:docs`
- `npm run build`
- `npm run check:dist-esm-imports`
- `npm run smoke:cli:dist`

`npm run check:coverage-ratchet` is regression-only: it protects touched existing covered source files from coverage drops, while `npm run test:coverage` still records the full repo snapshot for visibility.

Recommended additional checks:

```bash
npm run test
```

## Changelog policy

- Keep release-intended changes in `## Unreleased` while developing.
- Immediately before release, move them into the versioned section being cut.
- Keep notes user-facing and behavior-oriented, not implementation-only.

## CI/CD workflows

GitHub Actions handle verification and publish automation:

- `.github/workflows/ci.yml`
  - runs on pull requests and pushes to `main`
  - runs one full verify job on Ubuntu with Node `22.x`
  - includes packed tarball execution smoke
  - includes Windows compatibility smoke
  - includes security dependency audit gate
- `.github/workflows/release.yml`
  - on `v*` tag push, installs dependencies, runs `npm run verify` on Node `22.x`, publishes to npm with Trusted Publishing, and creates GitHub Release
  - publish job runs on Node `22.x`, enforces npm `>=11.5.1`, and fails early unless GitHub OIDC metadata + token claims match repository/workflow/environment expectations

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
2. Configure npm Trusted Publishing for:
   - repo: `iam-brain/opencode-codex-auth`
   - workflow: `.github/workflows/release.yml`
   - environment: `npm-release`
3. Ensure GitHub Actions are enabled for the repo.

## Trusted publishing preflight contract

`npm-publish` in `.github/workflows/release.yml` validates all of the following before `npm publish`:

1. `GITHUB_REPOSITORY` matches `iam-brain/opencode-codex-auth`.
2. `GITHUB_WORKFLOW_REF` points at `.github/workflows/release.yml`.
3. `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN` are present.
4. An OIDC token can be minted for `audience=npmjs`.
5. Decoded OIDC claims match:
   - repository: `iam-brain/opencode-codex-auth`
   - workflow: `.github/workflows/release.yml`
   - environment: `npm-release`

## OIDC troubleshooting

If release publish fails with `ENEEDAUTH`:

1. Confirm npm Trusted Publisher mapping exactly matches:
   - repo `iam-brain/opencode-codex-auth`
   - workflow `.github/workflows/release.yml`
   - environment `npm-release`
2. Confirm release publish job still has `id-token: write`.
3. Confirm preflight logs report a successful OIDC claim validation pass.
4. Confirm publish job runtime is Node `>=22.14` and npm `>=11.5.1`.
5. Re-run release after fixing mapping/runtime mismatch.

## Safety rules

- Do not run release commands unless publishing is intended.
- Do not manually edit generated `dist/` files.
- Prefer script-driven release flow over manual git tagging.
