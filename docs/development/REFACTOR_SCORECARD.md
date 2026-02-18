# Refactor Scorecard (Plan B)

## Baseline

- Date: 2026-02-18
- Branch: `refactor/selective-fixes-maintainability`
- Verify baseline: pass (`npm run verify`)
- Approx. codebase size snapshot (`index.ts` + `lib/**/*.ts` + `test/*.ts`): `29691` lines
- Current snapshot after passes (`index.ts` + `lib/**/*.ts` + `test/*.ts`): `29470` lines

## Goals

- Preserve functional coverage while reducing complexity.
- Improve maintainability in hotspot modules.
- Reduce code footprint through pruning and consolidation.

## Priority Hotspots

- `lib/config.ts` (mode/spoof precedence and mixed parsing concerns)
- `lib/storage.ts` (domain normalization + migration + IO + transfer paths)
- `lib/codex-native/request-transform.ts` (high branch count, duplicate wrappers)
- `lib/model-catalog.ts` (cache/fallback orchestration and parsing density)

## Pass Tracking

### Pass 0 - Guardrails

- [x] Baseline `npm run verify`
- [x] Characterization coverage locked for config precedence (`test/config.test.ts`)
- [x] Refactor scorecard created

### Pass 1 - Core Trio

- [x] 1A Config precedence cleanup (runtime mode authoritative; spoof compatibility fallback)
- [x] 1B Auth-domain hardening + storage complexity reduction
- [x] 1C Request-transform simplification + duplicate path removal

### Pass 2 - Auth UX and messaging

- [x] Standardize auth menu/tool messaging and taxonomy

### Pass 3 - Catalog/cache semantics

- [x] Tighten fallback semantics and modularize cache/fetch paths

### Pass 4 - Prune and consolidate

- [x] Remove dead/duplicate helpers and obsolete wrappers

### Pass 5 - Final docs and verification

- [x] Update docs/changelog for intentional deltas
- [x] Final `npm run verify`

## Completed Deltas (Plan B)

- Config precedence now treats runtime mode as canonical when explicit, with spoof input used as compatibility fallback only.
- Active account selection in merged auth view now prefers enabled identities (no disabled active identity carry-over).
- Request transform wrappers now delegate to one aggregate transform path to reduce duplicate parsing/branch logic.
- Auth/tool operator text now uses shared message builders for switch/toggle/remove actions.
- Model catalog stale-cache fallback emission path is consolidated for consistency and lower branch duplication.
- Removed dead tiny modules (`lib/constants.ts`, `lib/auth-refresh.ts`, `lib/tools-output.ts`) and centralized shared helpers.
