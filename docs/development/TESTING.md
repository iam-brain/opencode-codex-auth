# Testing

This repo uses Vitest.

## Commands

- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run verify` (typecheck + tests + build)

## Principles

- Keep tests offline and deterministic.
- Use temp directories for storage tests; never touch real `~/.config/opencode`.
- Never print tokens in test output.
