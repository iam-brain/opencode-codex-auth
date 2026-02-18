# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- Added experimental Codex collaboration profile gates (`runtime.collaborationProfile`, `runtime.orchestratorSubagents`) for plan/orchestrator parity.
- Collaboration features now auto-enable by default in `runtime.mode="codex"` and can be explicitly enabled/disabled in any mode.
- Added managed `orchestrator` agent template sync under `~/.config/opencode/agents`, with visibility auto-gated by runtime mode.
- Synced pinned upstream Codex orchestrator + plan templates into a local prompt cache (ETag/304-aware, TTL refreshed) and used the cached plan prompt to populate plan-mode collaboration instructions.
- Added configurable `runtime.promptCacheKeyStrategy` (`default` | `project`) for session-based or project-path-based prompt cache keying.
- Added quota threshold warnings at `25%`, `20%`, `10%`, `5%`, `2.5%`, `0%` and automatic cooldown/switch when `5h` or `weekly` quota is exhausted.
- Added account selection tracing and per-attempt failover reason codes for snapshot/debug observability.
- Added config file validation with actionable warnings on invalid types/values.
- Added upstream drift watch (`npm run check:upstream`) and native OAuth parity tests.
- Refactored cache layout + IO primitives into shared helpers (lock-guarded, atomic writes; best-effort persistence on failure).
- Hardened OAuth cancel handler: `/cancel` now requires a matching `state` value.
- Hardened local storage, snapshot logging, and trust boundaries across multiple security passes.
- Improved handling for accounts missing identity metadata: request-time auth acquisition can surface `missing_account_identity`, and status UI renders an explicit `identity-missing` badge and reset fallbacks.
- Replaced silent catches with explicit error handling throughout codebase.
- Reduced read contention and catalog fallback IO in storage paths.

## 0.3.2 - 2026-02-13

- Refactored `codex-native` into focused sub-modules: auth helpers, OAuth method flows, chat hooks, transform pipeline, state/catalog helpers, loader fetch pipeline.
- Replaced `customSettings` with `behaviorSettings` config system (`global` + `perModel` + `variants`).
- Added secret scanning CI workflow.
- Fixed audit findings: preserved request metadata, reduced auth lock contention.
- Aligned cache metadata refresh and instruction ordering.
- Hardened verify and runtime safeguards.

## 0.3.1 - 2026-02-12

- Removed experimental `collab` runtime mode; simplified to `native` and `codex`.
- Simplified installer surface to a single idempotent `install` flow.
- Updated docs, schema, and workflow configuration for current supported modes.
- Fixed compaction: codex checkpoint handoff only in `codex` mode, with mode-derived defaults and explicit toggle.
- Fixed codex instruction recovery from fallback caches.
- Defaulted AGENTS developer-role remap in `codex` mode.

## 0.3.0 - 2026-02-12

- Rewrote documentation for production-ready usage (getting-started, configuration, multi-account, compaction, privacy, troubleshooting, releasing).
- Added JSON schema files for config and accounts validation.
- Added documentation examples directory.

## 0.2.3 - 2026-02-11

- Auth menu styling polish: close quota snapshot box without hanging gap.

## 0.2.2 - 2026-02-11

- Auth menu styling polish: trim quota snapshot menu overhang.

## 0.2.1 - 2026-02-11

- Auth menu styling polish: attach quota output to login menu chrome.

## 0.2.0 - 2026-02-11

- Refactored `codex-native` into smaller modules.
- Added lint/format tooling and cache-first outbound networking improvements.

## 0.1.16 - 2026-02-11

- Fixed codex instruction overrides at send time.

## 0.1.15 - 2026-02-11

- Fixed catalog instruction replacement in outbound requests.

## 0.1.14 - 2026-02-11

- Aligned quota fetch behavior with codex-rs.
- Added in-vivo quota probe coverage.
- Fixed fallback behavior when model options are missing.

## 0.1.13 - 2026-02-11

- Enforced codex instruction injection with in-vivo regression coverage.

## 0.1.12 - 2026-02-11

- Fixed quota snapshot isolation for plus/team identities.

## 0.1.11 - 2026-02-11

- Hardened session affinity persistence and snapshot security.

## 0.1.10 - 2026-02-10

- Fixed OAuth callback binding to IPv4 loopback.
- Fixed session affinity persistence when prompt cache key is absent.

## 0.1.9 - 2026-02-10

- Hardened OAuth callback security and release gates.

## 0.1.8 - 2026-02-10

- Hardened session affinity.
- Added personality-builder skill support.

## 0.1.7 - 2026-02-10

- Fixed reasoning summary defaults.
- Shipped commented default config template.

## 0.1.6 - 2026-02-10

- Added persona tool and synchronized `/create-personality` install.

## 0.1.5 - 2026-02-10

- Fixed default generated config values and installer status labels.

## 0.1.4 - 2026-02-09

- Maintenance release.

## 0.1.3 - 2026-02-09

- Made legacy transfer checks deterministic in CI.

## 0.1.2 - 2026-02-09

- Maintenance release.

## 0.1.1 - 2026-02-09

- Added CI and npm badges in docs.
- Added old-plugin style npm publish workflow.

## 0.1.0 - 2026-02-05

- Initial release.
- Historical baseline entry; the first tagged release in git is `v0.1.1`.
