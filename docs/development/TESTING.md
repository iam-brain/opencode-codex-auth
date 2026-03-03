# Testing

This repo uses Vitest + TypeScript type checks.

## Core commands

```bash
npm run typecheck
npm test
npm run build
npm run lint
npm run test:anti-mock
npm run check:file-size
npm run check:coverage-ratchet
npm run check:docs
npm run verify
```

`npm run verify` is the pre-release gate.

It now includes strict Biome linting + format checks (including typed promise-safety rules), anti-mock policy checks, coverage ratcheting, file-size caps, docs drift checks, Node ESM regression checks (source + dist import specifiers), and a built CLI smoke run.

## Quality policy gates

- `npm run lint`
  - Runs Biome lint on source + tests with focused-test bans and typed promise-safety rules.
- `npm run test:anti-mock`
  - Enforces boundary-only mock policy.
  - No new `vi.doMock`/`vi.mock`/direct `vi.stubGlobal` usage beyond the tracked baseline in `scripts/test-mocking-allowlist.json`.
  - Shared global stub seam lives in `test/helpers/mock-policy.ts`.
- `npm run check:file-size`
  - Enforces source/test line-count caps with transitional allowlists in `scripts/file-size-allowlist.json`.
- `npm run check:coverage-ratchet`
  - Enforces global coverage floor and prevents touched-file coverage regressions against `scripts/coverage-ratchet.baseline.json`.
  - Uses `regressionTolerancePct: 1` from `scripts/coverage-ratchet.config.json` when comparing touched files to baseline.
  - Future milestones are tracked in `scripts/coverage-ratchet.config.json`.
- `npm run check:docs`
  - Enforces canonical-doc reference hygiene (deleted test paths, removed tooling references, and broken repo-relative Markdown links).

Vitest environment isolation:

- Tests run with isolated `HOME`, `XDG_*`, temp directories, and Windows home/appdata env vars (`USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `APPDATA`, `LOCALAPPDATA`) via `test/setup-env.ts`.
- This prevents test writes from touching the developer's real OpenCode config/cache paths.

Network hardening checks:

- Remote cache fetches enforce explicit HTTPS host allowlists and manual redirect validation.

Package smoke validation:

```bash
TARBALL="$(npm pack --silent)"
test -f "${TARBALL}"
npx --yes --package "./${TARBALL}" opencode-codex-auth --help
```

## Focused test runs

```bash
npx vitest run test/storage.test.ts
npx vitest run test/config-file-loading.test.ts
npx vitest run test/config-loading-resolve.test.ts
npx vitest run test/config-validation.test.ts
npx vitest run test/config-getters.test.ts
npx vitest run test/installer-cli.test.ts
npx vitest run test/codex-prompts-cache.test.ts
npx vitest run test/remote-cache-fetch.test.ts
npx vitest run test/cache-io.test.ts
npx vitest run test/codex-native-oauth-callback-flow.test.ts
npx vitest run test/acquire-auth-locking.test.ts
npx vitest run test/codex-native-collaboration.test.ts
npx vitest run test/prompt-cache-key.test.ts
npx vitest run test/codex-native-oauth-debug-gating.test.ts
npx vitest run test/request-snapshots.test.ts
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

## Optional in-vivo probes

Some probes intentionally read real OpenCode auth state from the default auth path and will make live network calls.

Enable in-vivo tests by setting:

- `CODEX_IN_VIVO=1`

Example:

```bash
CODEX_IN_VIVO=1 npx vitest run test/codex-quota-in-vivo.test.ts
```
