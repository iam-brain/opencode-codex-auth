# Accounts and Rotation

Canonical behavior sources: `lib/storage.ts`, `lib/rotation.ts`, `lib/fetch-orchestrator.ts`, `lib/codex-native.ts`.

## Storage model

Primary plugin account store:

- `~/.config/opencode/codex-accounts.json`

OpenAI OAuth domains are stored under `openai.native` and `openai.codex`, plus merged `openai.accounts` compatibility view.

## Identity invariants

Identity key format:

- `accountId|email|plan`

Normalization rules:

- `email` lowercased and trimmed
- `plan` lowercased and trimmed
- `accountId` trimmed

Matching preference:

1. strict identity key match
2. refresh-token fallback only when strict identity is unavailable

Coverage: `test/storage.test.ts`, `test/identity.test.ts`.

## Eligibility and failover

An account is selectable only when:

- `enabled !== false`
- no active cooldown (`cooldownUntil <= now`)

When a request gets `429`, the plugin sets cooldown and retries with another account (`lib/fetch-orchestrator.ts`).

Refresh error behavior (`lib/codex-native.ts`, `lib/proactive-refresh.ts`):

- `invalid_grant`: account is disabled
- other refresh failures: account is cooled down temporarily

Coverage: `test/fetch-orchestrator.test.ts`, `test/proactive-refresh.integration.test.ts`, `test/storage-cooldown.test.ts`.

## Rotation strategies

Configured by `runtime.rotationStrategy`:

- `sticky`
- `hybrid`
- `round_robin`

`sticky`:

- uses active account when healthy
- with PID/session affinity enabled, reuses per-session assignment

`hybrid`:

- prefers active account when valid
- otherwise uses least-recently-used healthy account
- supports session affinity assignment when enabled

`round_robin`:

- rotates to next healthy account each request

Coverage: `test/rotation.test.ts`, `test/codex-native-session-affinity.test.ts`.

## Interactive account manager

Open account manager:

```bash
opencode auth login
```

Main operations:

- add accounts
- check quotas
- enable/disable
- refresh token
- delete one or all accounts
- explicit legacy transfer when eligible

Implementation: `lib/codex-native.ts`, `lib/ui/auth-menu.ts`, `lib/ui/auth-menu-runner.ts`.

## Tool operations

Registered tools (`index.ts`):

- `codex-status`
- `codex-switch-accounts`
- `codex-toggle-account`
- `codex-remove-account`

Index arguments are 1-based (`lib/accounts-tools.ts`, `test/accounts-tools.test.ts`).

## Legacy transfer

Transfer is explicit-only and menu-driven.

Import candidates:

- `~/.config/opencode/openai-codex-accounts.json`
- `~/.local/share/opencode/auth.json`

If `codex-accounts.json` already exists, including empty accounts, it remains authoritative.

Coverage: `test/storage.test.ts`.
