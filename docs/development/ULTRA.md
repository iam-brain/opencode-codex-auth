# GPT-5.6 Ultra (WIP)

Ultra is a work-in-progress feature behind `runtime.ultra`, which defaults to `false`. The plugin treats enabled Ultra as a logical model variant, not as a new inference effort.

| State | Contract |
| --- | --- |
| Feature gate | `runtime.ultra` must be explicitly set to `true`. When disabled, Ultra is absent from provider/config variants and no agent policy is injected. |
| Catalog and picker | With the gate enabled, `ultra` remains distinct from `max` and is exposed only when the selected catalog model advertises the `ultra` effort, `multi_agent_version: "v2"`, visible status, and API support. |
| Root turn | An eligible Ultra turn in `codex` mode receives proactive delegation instructions: parallelize independent sidecar work, assign explicit ownership, avoid duplicate work, wait for required children, verify results, and synthesize them. Native mode preserves the OpenCode-native identity and does not add a Codex delegation overlay. |
| Child turn | A child inherits maximum reasoning but receives explicit-request-only delegation guidance to avoid uncontrolled recursive fan-out and duplicate parent or sibling work. |
| Auxiliary turn | OpenCode title, summary, and compaction turns retain wire normalization but receive no delegation instructions. |
| Backend request | Every literal `reasoning.effort: "ultra"` is normalized to `"max"` at the last-mile request transform. Explicit `max` never receives Ultra policy. |
| Missing or stale metadata | Ultra is disabled when catalog metadata cannot prove eligibility. A manually configured literal `ultra` is safe-degraded to wire `max` without proactive instructions. |
| Failure | Missing task tools, spawn failure, cancellation, or partial completion do not fail the root turn. The agent continues locally and must not claim delegation that did not happen. |

The live account-scoped catalog is authoritative. GitHub fallback data is parsed through the same schema and remains usable for ordinary model defaults when the live source is unavailable, but it cannot prove Ultra eligibility. The plugin does not recreate account entitlement or minimum-client enforcement from catalog metadata.

## State lifecycle

1. When `runtime.ultra=true`, `config` records each custom agent's OpenCode mode. `chat.params` resolves session lineage through OpenCode's session API and classifies the execution as root, child, or auxiliary. Session lineage is authoritative for `mode: all`; built-in and configured modes provide a fail-closed fallback.
2. The logical state is retained as `ultra`; eligible `codex`-mode root turns merge the proactive instruction idempotently, while `codex`-mode child turns merge the explicit-only instruction. Native mode keeps the logical state without prompt adaptation.
3. `chat.headers` records a redacted internal Ultra state marker alongside the existing catalog scope and selected-model markers.
4. Each retry resolves the current catalog scope again and applies the same last-mile normalization. Request snapshots include logical effort, wire effort, eligibility, policy, and the reason for any degradation.
5. Agent role is retained with the logical Ultra state across retries, account rotation, and catalog-scope changes. Stale catalog defaults are removed by the existing catalog-scope cleanup path.

## Degradation and guardrails

Ultra supplies the complete agent-mode policy available at the OpenCode plugin boundary. OpenCode remains the execution host for task tools, concurrency, steering, cancellation, and child lifecycle. A missing task tool or failed child spawn is observable in the host's normal tool/error path, but it is not a reason to reject the root request. Unknown agents and failed lineage lookups fail closed to child policy rather than enabling recursive fan-out.

No public concurrency setting is exposed. `runtime.ultra` is the only feature gate, and OpenCode remains authoritative for task tools and child lifecycle. The retired collaboration-profile/orchestrator WIP is not part of this flow.

## Verification matrix

The minimum release evidence covers:

- parser retention for effort descriptions, `multi_agent_version`, `minimal_client_version`, visibility, and API support;
- default-off config, schema, environment override, provider picker hiding, and explicit opt-in behavior;
- eligible Sol/Terra variants, ineligible V1/hidden/non-API variants, fallback catalogs, custom aliases, and effort suffixes;
- session-lineage classification for root, child, custom `mode: all`, built-in agents, and fail-closed lookup errors;
- root proactive, child explicit-only, and auxiliary-disabled instruction composition, including idempotent merges and preserved user/orchestrator instructions;
- literal Ultra normalization to wire Max, explicit Max remaining non-Ultra, and normalization on retries/catalog-scope changes;
- redacted snapshots for logical and wire state without internal headers reaching the backend;
- compaction and auxiliary request paths remaining safe because their payloads pass through the same last-mile transform;
- `npm run verify` and the distribution CLI smoke check.

## Rollout and rollback

Ultra follows the existing catalog-driven release path but remains marked WIP and default-off. It is visible only when the flag is enabled and authoritative metadata proves eligibility; there is no launch-time allowlist for Sol or Terra. Before publication or enabling it by default, run the full verification gate and a manual smoke using an eligible catalog response.

Rollback is the smallest code/config rollback that removes the Ultra instruction and variant eligibility predicate while leaving account storage and catalog caches intact. Existing literal `reasoningEffort: "ultra"` values remain safe because the request transform continues to send wire `max`. Upstream changes are tracked through `docs/development/UPSTREAM_SYNC.md` and the repository's upstream-watch configuration; a changed Ultra contract requires a new compatibility decision before behavior is broadened.
