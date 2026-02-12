# Testing

This repo uses Vitest + TypeScript type checks.

## Core commands

```bash
npm run typecheck
npm test
npm run build
npm run verify
```

`npm run verify` is the pre-release gate.

## Focused test runs

```bash
npx vitest run test/storage.test.ts
npx vitest run test/config.test.ts
npx vitest run test/installer-cli.test.ts
```

## Test design expectations

- Keep tests deterministic and offline.
- Use temp directories for filesystem tests.
- Never depend on real user home auth files in unit tests.
- Use fixtures in `test/fixtures/` when applicable.

## Areas with strong coverage

- storage migration/locking/atomic writes
- account rotation strategies + cooldown semantics
- auth menu actions and wiring
- config parsing and precedence
- model catalog shaping
- request snapshot redaction paths

## Manual smoke test checklist

Before production release, validate in a live OpenCode session:

1. login flow
2. add multiple accounts
3. quota rendering (`5h`, `Weekly`, `Credits`)
4. enable/disable/delete flows
5. one real request with OpenAI model
6. no malformed tool-call output
