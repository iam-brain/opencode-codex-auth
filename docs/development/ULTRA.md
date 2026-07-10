# GPT-5.6 Ultra

This plugin treats Ultra as a logical model variant, not as a new inference effort.

| State | Contract |
| --- | --- |
| Catalog and picker | `ultra` remains distinct from `max` and is exposed only when the selected catalog model advertises the `ultra` effort, `multi_agent_version: "v2"`, visible status, and API support. |
| Root turn | An eligible Ultra turn in `codex` mode receives a best-effort proactive delegation instruction. Native mode preserves the OpenCode-native identity and does not add a Codex delegation overlay. |
| Child turn | A child inherits maximum reasoning but receives explicit-request-only delegation guidance to avoid uncontrolled recursive fan-out. |
| Backend request | Every literal `reasoning.effort: "ultra"` is normalized to `"max"` at the last-mile request transform. Explicit `max` never receives Ultra policy. |
| Missing or stale metadata | Ultra is disabled when catalog metadata cannot prove eligibility. A manually configured literal `ultra` is safe-degraded to wire `max` without proactive instructions. |
| Failure | Missing task tools, disabled collaboration, spawn failure, cancellation, or partial completion do not fail the root turn. The agent continues locally and must not claim delegation that did not happen. |

The live account-scoped catalog is authoritative. GitHub fallback data is parsed through the same schema and is used only when the live source is unavailable. The plugin does not recreate account entitlement or minimum-client enforcement from catalog metadata.

## State lifecycle

1. `chat.params` resolves the selected model, effort suffix, variant, and custom-model target against the active catalog.
2. The logical state is retained as `ultra`; eligible `codex`-mode root turns merge the proactive instruction idempotently, while `codex`-mode child turns merge the explicit-only instruction. Native mode keeps the logical state without prompt adaptation.
3. `chat.headers` records a redacted internal Ultra state marker alongside the existing catalog scope and selected-model markers.
4. Each retry resolves the current catalog scope again and applies the same last-mile normalization. Request snapshots include logical effort, wire effort, eligibility, policy, and the reason for any degradation.
5. Compaction, resume, account rotation, and catalog-scope changes inherit only the state represented by the current request and catalog. Stale catalog defaults are removed by the existing catalog-scope cleanup path.

## Degradation and guardrails

Ultra is best effort at the OpenCode collaboration boundary. The plugin does not claim parity with proprietary desktop orchestration. A missing task tool or failed child spawn is observable in the host's normal tool/error path, but it is not a reason to reject the root request. Child turns are explicit-only by default; the host remains responsible for its own concurrency and cancellation controls.

No new public concurrency or feature flag is required. Existing collaboration-profile and subagent controls remain authoritative, and no private catalog/runtime default is added to public configuration.

## Verification matrix

The minimum release evidence covers:

- parser retention for effort descriptions, `multi_agent_version`, `minimal_client_version`, visibility, and API support;
- eligible Sol/Terra variants, ineligible V1/hidden/non-API variants, fallback catalogs, custom aliases, and effort suffixes;
- root proactive and child explicit-only instruction composition, including idempotent merges and preserved user/orchestrator instructions;
- literal Ultra normalization to wire Max, explicit Max remaining non-Ultra, and normalization on retries/catalog-scope changes;
- redacted snapshots for logical and wire state without internal headers reaching the backend;
- compaction and auxiliary request paths remaining safe because their payloads pass through the same last-mile transform;
- `npm run verify` and the distribution CLI smoke check.

## Rollout and rollback

Ultra follows the existing catalog-driven release path. It is visible only when authoritative metadata proves eligibility; there is no launch-time allowlist for Sol or Terra and no package release in this change. Before publication, run the full verification gate and a manual smoke using an eligible catalog response.

Rollback is the smallest code/config rollback that removes the Ultra instruction and variant eligibility predicate while leaving account storage and catalog caches intact. Existing literal `reasoningEffort: "ultra"` values remain safe because the request transform continues to send wire `max`. Upstream changes are tracked through `docs/development/UPSTREAM_SYNC.md` and the repository's upstream-watch configuration; a changed Ultra contract requires a new compatibility decision before behavior is broadened.
