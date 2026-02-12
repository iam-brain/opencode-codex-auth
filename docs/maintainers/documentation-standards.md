# Documentation Standards

## Objective

Keep docs production-ready, concise, and grounded in current code and tests.

## Source-of-truth policy

Every behavior claim must be traceable to:

1. implementation file(s), and
2. validating test(s)

Required citation style in docs PRs: inline file paths such as `lib/config.ts`, `test/config.test.ts`.

## Writing rules

- Prefer operational instructions over narrative.
- Remove agentic wording (for example, "the assistant decides").
- Avoid ambiguous terms without conditions (for example, "usually", "sometimes").
- Separate user guidance from maintainer internals.

## Drift control

When updating behavior, update docs in the same PR if any of these change:

- config keys or defaults (`lib/config.ts`, `schemas/codex-config.schema.json`)
- auth/storage behavior (`lib/storage.ts`, `lib/codex-native.ts`)
- release workflow (`scripts/release.js`, workflows)

## Required checks for docs changes

- `npm run format:check`
- `npm run verify`

Recommended additions to CI for docs quality:

- markdown lint (`docs:lint`)
- link validation (`docs:links`)
- docs drift checks for config/env tables (`docs:drift`)

## Review checklist

- Claims match current implementation.
- Commands are executable and include expected outcomes.
- File paths are accurate and current.
- Duplicate content is removed.
- Security and privacy statements do not overstate behavior.
