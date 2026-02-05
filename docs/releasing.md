# Releasing

This repo is local-only by default.

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
