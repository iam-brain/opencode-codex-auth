# Contributing

Thanks for contributing to `@iam-brain/opencode-codex-auth`.

## Local setup

```bash
npm ci
npm run verify
```

`npm run verify` is the baseline gate (`package.json`):

- `npm run typecheck`
- `npm test`
- `npm run build`

## Pull request requirements

- Keep changes scoped to one task.
- Add or update tests for behavior changes.
- Include verification commands and results in the PR description.
- Update docs when behavior, config, or operator workflows change.

## Test guidance

- Keep tests deterministic and offline.
- Use fixtures from `test/fixtures/auth-single.json` and `test/fixtures/auth-multi.json` when applicable.
- Use temp directories for filesystem tests.

## Security disclosures

Use the private disclosure flow in `SECURITY.md`.
