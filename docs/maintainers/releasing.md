# Releasing

Canonical release implementation source: `scripts/release.js`.

## Preconditions

Release script requirements:

- current branch is `main`
- working tree is clean
- `npm run verify` passes

The script enforces these checks before version bump and push.

## Release commands

Use scripted release commands only:

```bash
npm run release:patch
npm run release:minor
npm run release:major
```

These call:

```bash
npm run release -- <patch|minor|major>
```

## Release script flow

`scripts/release.js` executes:

1. branch check (`main`)
2. clean working tree check
3. `npm run verify`
4. `npm version <bump> -m "release: v%s"`
5. `git push origin main --follow-tags`
6. optional `gh release view` polling when `gh` is available and authenticated

## CI and publish workflows

- CI verification: `.github/workflows/ci.yml`
- npm publish + GitHub release on tags: `.github/workflows/release.yml`
- dependency review on PRs: `.github/workflows/dependency-review.yml`

## Changelog policy

- Keep in-progress release notes under `## Unreleased` in `CHANGELOG.md`.
- Before release, move release-ready notes to a new version heading.
- Keep entries behavior-focused and user/operator facing.

## Manual smoke checklist

Before final release, verify in an OpenCode session:

1. login flow succeeds
2. add multiple accounts
3. quota check shows `5h`, `Weekly`, `Credits`
4. toggle account enabled state
5. refresh account token
6. scoped delete and delete-all paths behave correctly
7. one real `openai/*` request succeeds

## Safety rules

- Do not publish from feature branches.
- Do not bypass scripted release flow.
- Do not edit generated `dist/` files manually.
