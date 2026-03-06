This file provides coding guidance for AI agents working in this repository.

## Overview

This is an **OpenCode plugin** for OpenAI OAuth that routes OpenCode OpenAI traffic to the Codex backend.

Repository focus:
- Native-plugin baseline behavior plus multi-account account storage/rotation.
- Two runtime identity styles (`native`, `codex`).
- Codex-style account management UX in `opencode auth login`.

## Documentation quick map (read first)

Primary indexes:
- `docs/index.md`
- `docs/README.md`
- `docs/development/README.md`

Core implementation docs:
- `docs/development/ARCHITECTURE.md`
- `docs/development/CONFIG_FIELDS.md`
- `docs/development/CONFIG_FLOW.md`
- `docs/development/TESTING.md`
- `docs/development/UPSTREAM_SYNC.md`

Current planning docs:
- `docs/plans/` (if present in local workspace)

## Current storage and config

Canonical files:
- Plugin config: `~/.config/opencode/codex-config.json`
- Plugin accounts: `~/.config/opencode/codex-accounts.json`
- OpenCode provider auth marker: `${XDG_DATA_HOME:-~/.local/share}/opencode/auth.json`
- Optional request snapshots/logs: `<config-root>/logs/codex-plugin/`

Important:
- `opencode.json` should only contain plugin installation/enablement.
- Runtime flags and behavior go in `codex-config.json`.

## Modes

- `mode: "native"` (default): **carbon-copy target of OpenCode native plugin behavior** (originator/header semantics and overall request identity path), with this plugin's multi-account/auth management layered in.
- `mode: "codex"`: **full codex spoof** (codex-rs style identity/headers/auth profile).

Upstream version tracking and sync workflow are documented in:
- `docs/development/UPSTREAM_SYNC.md`

## Account invariants

- Strict account identity key: `accountId|email|plan`.
- Account matching prefers strict identity; refresh-token fallback only when identity is unavailable.
- Disabled accounts are never selected or refreshed by automated runtime flows.
- Storage writes are lock-guarded and atomic (temp + rename, best-effort `0600`).

## Legacy import behavior

Legacy sources are supported only through explicit transfer:
- `~/.config/opencode/openai-codex-accounts.json`
- `${XDG_DATA_HOME:-~/.local/share}/opencode/auth.json`

No automatic legacy fallback during normal load.
Use `opencode auth login` -> `Transfer OpenAI accounts from native & old plugins?`.

## Build and test

```bash
npm run typecheck
npm test
npm run build
npm run verify
```

`npm run verify` is the default pre-release check.

## Test fixtures

Use only repository fixtures under:
- `test/fixtures/auth-single.json`
- `test/fixtures/auth-multi.json`

Do not invent account IDs/emails/tokens in tests when fixtures already cover the scenario.
Treat the anti-mock policy as methodology guidance, not a hard ban: prefer lower-mock tests, but use focused mocks when they produce clearer and more reliable coverage for the behavior under test.

## Release safety

- Never run release/publish commands unless explicitly requested.
- Prefer evidence (`npm run verify`, focused vitest runs, real smoke checks) over assertions.
- Keep diffs scoped; avoid unrelated refactors.

## Git lock safety

- Never run mutating git commands in parallel (`git add`, `git commit`, `git merge`, `git rebase`, `git push`).
- Turn interruptions can leave stale lock files (especially `.git/index.lock`).
- If git reports a lock and no git process is active, remove only the stale lock file and retry.
- Prefer serialized release shortcuts (`npm run release:patch|minor|major`) over manual multi-command git sequences.

## Model catalog safety

- Treat the live Codex model cache as authoritative and the GitHub `models.json` snapshot as the only fallback source of truth; never synthesize cross-slug model metadata by cloning another provider model.
- When integrating catalog/runtime behavior, only handle states representable by the live endpoint response or upstream official docs; do not add fallback logic for hypothetical missing metadata.
