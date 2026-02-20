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
  - periodic quota usage refresh + threshold warnings (`25%`, `20%`, `10%`, `5%`, `2.5%`, `0%`)
  - automatic cooldown/switch trigger when `5h` or `weekly` quota reaches `0%`
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
- `lib/codex-native/collaboration.ts`
  - plan-mode, orchestrator, and subagent collaboration instruction injection
- `lib/codex-native/originator.ts`
  - originator header resolution (mode-aware `opencode` vs `codex_cli_rs`/`codex_exec`)
- `lib/codex-native/browser.ts`
  - system browser launch for OAuth callback flow
- `lib/codex-native/session-affinity-state.ts`, `lib/codex-native/rate-limit-snapshots.ts`, `lib/codex-native/request-routing.ts`
  - session affinity persistence, rate-limit snapshot persistence, outbound URL guard/rewrite
- `lib/storage.ts`
  - lock-guarded auth store IO, migration normalization, explicit legacy transfer
- `lib/rotation.ts`
  - `sticky`, `hybrid`, `round_robin` account selection
- `lib/fetch-orchestrator.ts`
  - retry/failover control around backend requests
  - standardized per-attempt failover reason codes (`initial_attempt`, `retry_same_account_after_429`, `retry_switched_account_after_429`) for snapshot/debug observability
  - failover toasts stay concise for end users; reason-code taxonomy remains available in snapshot/debug metadata
- `lib/proactive-refresh.ts`
  - optional background refresh with lease/cooldown guards
- `lib/model-catalog.ts`
  - dynamic model catalog fetch/cache and provider model shaping
  - account-scoped server cache shards (`codex-auth-models-*.json`, `codex-models-cache-<hash>.json`)
  - shared GitHub catalog cache (`codex-models-cache.json`) + metadata (`codex-models-cache-meta.json`)
- `lib/codex-native/client-identity.ts`
  - Codex client version resolution/refresh cache (`codex-client-version.json`)
  - release-tag to semver normalization used by catalog/instruction refresh logic
- `lib/personality-command.ts`
  - `/create-personality` command template install/bootstrap
- `lib/personality-create.ts`
  - custom personality file generation with enforced core assistant contract
- `lib/personalities.ts`
  - custom personality resolution from lowercase `personalities/` directories
- `lib/ui/auth-menu.ts`, `lib/ui/auth-menu-runner.ts`
  - TTY account manager UI
- `lib/accounts-tools.ts`
  - tool handler logic for `codex-status`, `codex-switch-accounts`, `codex-toggle-account`, `codex-remove-account`
- `lib/codex-status-tool.ts`, `lib/codex-status-storage.ts`, `lib/codex-status-ui.ts`
  - account status/usage tracking, persistence, and display formatting
- `lib/codex-prompts-cache.ts`
  - pinned upstream prompt fetch/sync (orchestrator + plan templates) with ETag/TTL refresh
- `lib/orchestrator-agent.ts`
  - managed `orchestrator.md` agent template sync and visibility gating
- `lib/quarantine.ts`
  - corrupted auth file detection and recovery
- `lib/quota-threshold-alerts.ts`
  - quota percentage threshold warnings and cooldown triggers
- `lib/cache-io.ts`, `lib/cache-lock.ts`, `lib/codex-cache-layout.ts`
  - shared cache IO primitives, lock helpers, and cache directory layout
- `lib/persona-tool.ts`, `lib/personality-skill.ts`
  - persona generation logic and `personality-builder` skill bundle management
- `lib/identity.ts`
  - account identity key normalization and generation

## Auth and account files

- Primary plugin store (runtime-authoritative): `<config-root>/codex-accounts.json`
- OpenCode provider marker/import source: `${XDG_DATA_HOME:-~/.local/share}/opencode/auth.json`

## Cache files (model/instruction path)

- `<config-root>/cache/codex-client-version.json`
  - canonical cached target client version (`version`, `fetchedAt`)
- `<config-root>/cache/codex-models-cache-meta.json`
  - shared GitHub catalog metadata (`etag`, `tag`, `lastChecked`, `url`), aligned with instruction metadata files
- `<config-root>/cache/codex-models-cache.json`
  - shared GitHub catalog snapshot used as stale fallback and refresh target
- `<config-root>/cache/codex-models-cache-<hash>.json`
  - account-scoped server catalog mirror
- `<config-root>/cache/codex-auth-models-<hash>.json`
  - plugin-primary account-scoped server catalog cache
- Existing instruction caches (for example `codex-instructions.md` + `codex-instructions-meta.json`) remain separate artifacts under the same cache root.

## Cache files (pinned prompt sync)

- `<config-root>/cache/codex-prompts-cache.json`
  - pinned upstream prompt text for:
    - Codex orchestrator agent template
    - Codex plan-mode collaboration prompt
- `<config-root>/cache/codex-prompts-cache-meta.json`
  - prompt-cache metadata (`lastChecked`, URLs, ETags)

Fetch behavior is best-effort and uses ETag/304 revalidation plus a TTL to limit network traffic.

## Invariants

- Strict account identity key: `accountId|email|plan`
- Disabled accounts are never selected or refreshed by automated runtime flows
- Read/merge/write runs under `proper-lockfile`
- Writes are atomic (`tmp` + rename; best-effort `0600`)
- Legacy import is explicit via transfer action, not implicit during normal reads
- Existing `codex-accounts.json` remains authoritative even when empty
