# Architecture

This plugin bridges OpenCode's OpenAI provider hooks to the ChatGPT Codex backend API using OAuth.

## High-level flow

1) OpenCode calls the plugin `auth.loader` to obtain provider auth.
2) The plugin selects an enabled account using the rotation strategy.
3) Requests are rewritten to the Codex backend endpoint.
4) `429` rate limits trigger cooldown persistence + failover to another enabled account.

## Key modules

- `index.ts`: registers plugin hooks + tools.
- `lib/codex-native.ts`: OAuth flows, request rewrite, model filtering.
- `lib/storage.ts`: `auth.json` read/migrate/write under `proper-lockfile` with atomic writes.
- `lib/rotation.ts`: selection strategies.
- `lib/fetch-orchestrator.ts`: 429 handling and retry safety.
- `lib/proactive-refresh.ts`: optional enabled-only background refresh.

## Safety invariants

- Disabled accounts are never selected or mutated.
- `identityKey` derivation is stable and only based on `accountId|email|plan`.
- Storage updates are done under one lock with atomic writes.
