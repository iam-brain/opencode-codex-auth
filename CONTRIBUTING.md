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

Pull request GitHub CI keeps clean-room verify, Linux tarball smoke, Windows smoke, and secret scanning. PR pushes do not start these checks: after reviewing the exact head, a maintainer dispatches `reviewed-pr.yml` from `main` with the PR number and reviewed head/base SHAs, including for fork PRs. Follow the [manual validation instructions](docs/development/TESTING.md#trusted-manual-validation) and wait for the tested merge result's checks before merging. `npm audit` still runs in GitHub, but only on default-branch pushes rather than every PR.

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
