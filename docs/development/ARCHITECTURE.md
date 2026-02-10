# Architecture

This plugin bridges OpenCode's OpenAI provider hooks to ChatGPT Codex backend endpoints using OAuth.

## Runtime overview

1. OpenCode initializes plugin hooks (`index.ts`).
2. Config is resolved from `codex-config.json` + env overrides (`lib/config.ts`).
3. Collab agent files are reconciled to match runtime mode (`lib/orchestrator-agents.ts`).
4. Auth loader selects a healthy account (`lib/storage.ts`, `lib/rotation.ts`).
5. Requests are transformed and routed through Codex backend paths (`lib/codex-native.ts`).
6. Failures (`429`, refresh/auth) trigger cooldown/disable semantics and retry orchestration (`lib/fetch-orchestrator.ts`).

## Key modules

- `index.ts`
  - plugin entrypoint, config wiring, tools registration, proactive refresh scheduler
- `lib/codex-native.ts`
  - OAuth/login flow, account menu wiring, request rewriting, mode-specific header identity behavior
- `lib/storage.ts`
  - lock-guarded auth store IO, migration normalization, explicit legacy transfer
- `lib/rotation.ts`
  - `sticky`, `hybrid`, `round_robin` account selection
- `lib/fetch-orchestrator.ts`
  - retry/failover control around backend requests
- `lib/proactive-refresh.ts`
  - optional background refresh with lease/cooldown guards
- `lib/model-catalog.ts`
  - dynamic model catalog fetch/cache and provider model shaping
- `lib/orchestrator-agents.ts`
  - Codex agent template install + `.md/.md.disabled` reconciliation
- `lib/personality-command.ts`
  - `/create-personality` command template install/bootstrap
- `lib/personality-create.ts`
  - custom personality file generation with enforced core assistant contract
- `lib/personalities.ts`
  - custom personality resolution from lowercase `personalities/` directories
- `lib/ui/auth-menu.ts`, `lib/ui/auth-menu-runner.ts`
  - TTY account manager UI

## Auth and account files

- Provider marker: `~/.local/share/opencode/auth.json`
- Plugin store: `~/.config/opencode/codex-accounts.json`

## Invariants

- Strict account identity key: `accountId|email|plan`
- Disabled accounts are never selected/refreshed/mutated
- Read/merge/write runs under `proper-lockfile`
- Writes are atomic (`tmp` + rename; best-effort `0600`)
- Legacy import is explicit via transfer action, not implicit during normal reads
- Existing `codex-accounts.json` remains authoritative even when empty

## Collaboration-mode file behavior

Installer writes Codex agent templates as disabled files (`*.md.disabled`).

On startup:

- `mode=collab` -> activate to `*.md`
- `mode=native|codex` -> keep/rename to `*.md.disabled`
