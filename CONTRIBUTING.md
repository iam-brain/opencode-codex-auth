# Contributing

Thanks for contributing to `opencode-codex-auth`.

## Development setup

```bash
npm ci
npm run verify
```

`npm run verify` is the baseline gate and runs:

- `npm run typecheck`
- `npm test`
- `npm run build`

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
