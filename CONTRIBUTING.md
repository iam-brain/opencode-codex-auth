# Contributing

Thanks for contributing to `opencode-codex-auth`.

## Development setup

```bash
npm ci
npm run hooks:install
npm run verify
```

`npm run prepush` is the recommended local gate before pushing a branch. It runs:

- `npm run format:check`
- `npm run typecheck`
- `npm run typecheck:test`
- `npm test`

`npm run verify` is the baseline full gate and runs:

- `npm run prepush`
- `npm run test:anti-mock`
- `npm run test:coverage`
- `npm run check:coverage-ratchet`
- `npm run check:docs`
- `npm run build`
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
