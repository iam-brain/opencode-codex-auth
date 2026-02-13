# Architecture

This plugin bridges OpenCode's OpenAI provider hooks to ChatGPT Codex backend endpoints using OAuth.

## Runtime overview

1. OpenCode initializes plugin hooks (`index.ts`).
2. Config is resolved from `codex-config.json` + env overrides (`lib/config.ts`).
3. Auth loader selects a healthy account (`lib/storage.ts`, `lib/rotation.ts`).
4. `CodexAuthPlugin` wires modular auth/request helpers under `lib/codex-native/` and routes Codex backend requests.
5. Failures (`429`, refresh/auth) trigger cooldown/disable semantics and retry orchestration (`lib/fetch-orchestrator.ts`).

## Key modules

- `index.ts`
  - plugin entrypoint, config wiring, tools registration, proactive refresh scheduler
- `lib/codex-native.ts`
  - top-level plugin wiring + hook registration (delegates to focused modules)
- `lib/codex-native/openai-loader-fetch.ts`
  - OpenAI fetch pipeline (header shaping, request transforms, auth acquisition, retries, response snapshots)
- `lib/codex-native/acquire-auth.ts`
  - account selection + token refresh/cooldown/invalid-grant handling
- `lib/codex-native/auth-menu-flow.ts`
  - interactive account menu wiring + transfer/toggle/delete/refresh actions
- `lib/codex-native/auth-menu-quotas.ts`
  - auth-menu quota snapshot refresh + cooldown handling
- `lib/codex-native/oauth-auth-methods.ts`, `lib/codex-native/oauth-persistence.ts`, `lib/codex-native/oauth-utils.ts`, `lib/codex-native/oauth-server.ts`
  - browser/headless OAuth method flows, token persistence, OAuth primitives, callback server lifecycle
- `lib/codex-native/request-transform-pipeline.ts`, `lib/codex-native/request-transform.ts`, `lib/codex-native/chat-hooks.ts`, `lib/codex-native/session-messages.ts`
  - request/body transform pipeline and chat hook behavior (params/headers/compaction)
- `lib/codex-native/catalog-sync.ts`, `lib/codex-native/catalog-auth.ts`
  - model-catalog bootstrap and refresh wiring
- `lib/codex-native/session-affinity-state.ts`, `lib/codex-native/rate-limit-snapshots.ts`, `lib/codex-native/request-routing.ts`
  - session affinity persistence, rate-limit snapshot persistence, outbound URL guard/rewrite
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
