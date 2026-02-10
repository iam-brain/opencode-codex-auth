# Architecture

This plugin bridges OpenCode's OpenAI provider hooks to the ChatGPT Codex backend API using OAuth.

## High-level flow

1) OpenCode calls the plugin `auth.loader` to obtain provider auth.
2) The plugin selects an enabled account using the rotation strategy.
3) Requests are rewritten to the Codex backend endpoint.
4) Request-time auth acquisition and `429` handling both support failover across enabled accounts (with cooldown/disable semantics based on failure type).

## Key modules

- `index.ts`: registers plugin hooks + tools.
- `lib/codex-native.ts`: OAuth flows, request rewrite, model filtering, auth-menu orchestration.
- `lib/storage.ts`: `codex-accounts.json` read/migrate/write under `proper-lockfile` with atomic writes (`openai-codex-accounts.json`, sibling `auth.json`, and OpenCode provider marker fallback supported).
- `lib/rotation.ts`: selection strategies.
- `lib/fetch-orchestrator.ts`: 429 handling and retry safety.
- `lib/proactive-refresh.ts`: optional enabled-only background refresh with lease + cooldown guards.
- `lib/codex-quota-fetch.ts`: live quota fetch (`/backend-api/wham/usage` with fallback) normalized to internal snapshot model.
- `lib/codex-status-ui.ts`: account quota rendering (`5h`, `Weekly`, `Credits`).
- `lib/ui/auth-menu.ts` + `lib/ui/auth-menu-runner.ts`: TTY account-manager menus.

## Auth state locations

- OpenCode provider auth marker: `~/.local/share/opencode/auth.json`
- Plugin multi-account storage and rotation state: `~/.config/opencode/codex-accounts.json`

## Safety invariants

- Disabled accounts are never selected or mutated.
- `identityKey` derivation is stable and only based on `accountId|email|plan`.
- Storage updates are done under one lock with atomic writes.
- Proactive refresh uses lock-backed leasing (`refreshLeaseUntil`) to avoid duplicate concurrent refresh work.
- If `codex-accounts.json` exists with `openai.accounts: []`, it is treated as authoritative (no implicit legacy reseed).
