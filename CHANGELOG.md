# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

- Removed experimental `collab` runtime mode and related template wiring from mainline plugin behavior.
- Simplified installer surface to a single idempotent `install` flow.
- Updated docs, schema, and workflow configuration for current supported modes (`native`, `codex`).
- Added experimental Codex collaboration profile gates (`runtime.collaborationProfile`, `runtime.orchestratorSubagents`) for plan/orchestrator parity.
- Collaboration features now auto-enable by default in `runtime.mode="codex"` and can be explicitly enabled/disabled in any mode.
- Added `runtime.collaborationToolProfile` (`opencode` | `codex`) to choose OpenCode tool translation guidance vs codex-style tool semantics in injected collaboration instructions.
- Added managed `orchestrator` agent template sync under `~/.config/opencode/agents`, with visibility auto-gated by runtime mode.

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
