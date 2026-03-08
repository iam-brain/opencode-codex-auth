# Contributing

Thanks for contributing to `opencode-codex-auth`.

## Development setup

```bash
npm ci
npm run hooks:install
npm run verify
```

Local hooks enforce `npm run verify` before both commits and pushes once you run `npm run hooks:install`.
The commit hook accepts staged-only commit-ready changes, while the push hook requires a clean tree so it validates the exact commits being pushed.

`npm run verify:local` is the recommended manual gate. It runs `npm run verify`, but skips reruns when the current tree already passed locally.

Pull request GitHub CI keeps only hosted-value checks: clean-room verify, Linux tarball smoke, Windows smoke, dependency review, and secret scanning. `npm audit` still runs in GitHub, but only on default-branch pushes rather than every PR.

`npm run verify` is the baseline full gate and runs:

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

## Pull requests

- Keep diffs task-scoped and avoid unrelated refactors.
- Add or update tests for behavior changes.
- Include a short verification note in the PR description.

## Testing guidance

- Prefer deterministic, offline tests.
- Use fixtures under `test/fixtures/` when applicable.
- For filesystem cases, use temporary directories.

## Security

For vulnerabilities, follow `SECURITY.md` and use private disclosure.
