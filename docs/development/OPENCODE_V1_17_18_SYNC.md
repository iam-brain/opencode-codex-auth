# OpenCode v1.3.0 → v1.17.18 sync findings

Research date: 2026-07-10. Compared upstream commits `eb3bfffad453f1c8c3f0f92bba0d8e34c83fa244` (`v1.3.0`) and `b1fc8113948b518835c2a39ece49553cffe9b30c` (`v1.17.18`). Scope is the built-in ChatGPT/Codex OAuth plugin and adjacent OpenAI provider, auth, catalog, transform, and retry behavior. Sources are first-party tagged files, commits, and compares only.

## Executive summary

Most upstream churn is architectural, but five behavior changes matter here:

1. **Request identity changed:** OpenCode now sends `session-id`, not `session_id`, with `originator: opencode` and an `opencode/<version> (<platform>...)` user agent. This repo previously emitted `session_id`; the parity defect is fixed in this sync while legacy input and redaction compatibility remain. [Upstream fix](https://github.com/anomalyco/opencode/commit/a78605f8ea1a6e56cab516c20d9b3311cd0ce0b1) and [v1.17.18 implementation](https://github.com/anomalyco/opencode/blob/v1.17.18/packages/opencode/src/plugin/openai/codex.ts#L541-L554).
2. **OAuth model selection became catalog-driven:** the plugin no longer invents a hard-coded GPT-5.3 model. It filters the provider catalog through the `provider.models` hook, zeroes subscription costs, corrects GPT-5.5 limits, explicitly hides `gpt-5.5-pro`, and admits future `gpt-X.Y` models when the version is greater than 5.4. [Removal of synthesized model](https://github.com/anomalyco/opencode/commit/2929774acb2eb694800bccfc6a9f84ec691eb999), [models-hook migration](https://github.com/anomalyco/opencode/commit/b80f52f8ad3173acee143e1355a2ab4585443db1), and [current filter](https://github.com/anomalyco/opencode/blob/v1.17.18/packages/opencode/src/plugin/openai/codex.ts#L279-L309).
3. **Concurrent refresh is deduplicated:** one in-flight refresh promise is shared by requests using the native OpenCode credential. This repo has richer per-account acquisition/rotation, so it must preserve deduplication per strict account identity rather than adopt upstream's single global promise literally. [Fix](https://github.com/anomalyco/opencode/commit/c64ac905e19cd881e4d3c8af6449f228941a2674) and [tagged code](https://github.com/anomalyco/opencode/blob/v1.17.18/packages/opencode/src/plugin/openai/codex.ts#L327-L396).
4. **OpenAI Responses WebSockets were added as an experimental transport.** This caused the file move and adds pooling, lifecycle cleanup, HTTP fallback for title requests, custom base-URL support, and stream retry/idle fixes. It is optional for this plugin unless it intentionally exposes the transport; HTTP remains supported. [Transport commit and rename](https://github.com/anomalyco/opencode/commit/62da1e76826276b493ce7f8a9581d482cd7c16ee), [custom URL fix](https://github.com/anomalyco/opencode/commit/ec26d7845005d5db3166b9d181f802b04e99d864), [stream retry fix](https://github.com/anomalyco/opencode/commit/14e0b9b17f886c9157c92e1b98caca5a40d21797), and [idle-state fix](https://github.com/anomalyco/opencode/commit/7f8412ec3e8b964ae3794e5c38e67dbe100c4cc7).
5. **OpenCode does not implement a special GPT-5.6 Ultra wire effort.** At v1.17.18 it accepts future post-5.4 model IDs through the dynamic filter, while reasoning variants come from provider/catalog capabilities. Therefore this repo's logical `ultra` → wire `max` policy remains a Codex-runtime extension, not an OpenCode-native parity item; keep it catalog-gated and keep native mode free of the Codex collaboration overlay.

The current [OpenCode plugin documentation](https://opencode.ai/docs/plugins/) confirms sequential hook execution and lifecycle event delivery, including `session.deleted`. The v1.17.18 package contract additionally exposes `dispose`, plugin option tuples, and a v1 default module object. This plugin now composes `dispose` to stop its proactive-refresh scheduler. It intentionally keeps the function export for older-loader compatibility and keeps runtime settings in `codex-config.jsonc`; plugin option tuples are therefore not used as a second configuration surface.

The full tagged comparison is [v1.3.0...v1.17.18](https://github.com/anomalyco/opencode/compare/v1.3.0...v1.17.18).

## File/path migration map

| v1.3.0 | v1.17.18 | Meaning | Action here |
|---|---|---|---|
| `packages/opencode/src/plugin/codex.ts` | `packages/opencode/src/plugin/openai/codex.ts` plus `openai/ws.ts` and `openai/ws-pool.ts` | The May 27 Responses-WebSocket change grouped the Codex OAuth adapter with OpenAI-specific transports. The tagged diff still recognizes a 57% rename; this is organization plus substantial behavior, not a replacement of the built-in plugin. | Update upstream-watch path; optionally watch both WebSocket files. Do not mirror the folder layout locally merely for parity. |
| `packages/opencode/src/provider/models.ts` | `packages/core/src/models-dev.ts` | Moved into `@opencode-ai/core`; core now owns the models.dev schema, bundled snapshot, cache, refresh, and flags. [Move commit](https://github.com/anomalyco/opencode/commit/16c457e71233b2eca6a73aa292ec1ed225d87af7). | Replace the dead watch path with `packages/core/src/models-dev.ts` (and `packages/core/src/catalog.ts` if tracking the core catalog contract). Keep this repo's separate account-scoped Codex catalog. |
| hard-coded model creation inside Codex loader | `provider.models` hook over the resolved provider catalog | Catalog entries are no longer synthesized by the OAuth adapter. | Preserve this repo's live Codex catalog authority; remove/avoid cross-model metadata synthesis. |
| inline Bun OAuth server/pages | Node `http.createServer` plus shared `OauthCallbackPage` | Runtime portability and shared presentation; callback URI, PKCE/state validation, and token semantics are materially unchanged. [Node migration](https://github.com/anomalyco/opencode/commit/2e4c43c1cf6a14c6b2d1d502b70337fae35bc1ce) and [shared page](https://github.com/anomalyco/opencode/commit/e8fea9e63a437fb839fa925a6b63ace31b243471). | No behavior port required; local Node controller already covers this boundary. |
| provider/session namespace and Zod-era schemas | Effect/core-owned schemas and split session LLM modules | Broad internal architecture migration. | No direct port; consume only public plugin/SDK contracts. |

## Behavior changes by risk

### High / breaking for parity

- **Header spelling:** `session-id` replaced `session_id`. Local `lib/codex-native/chat-hooks.ts` and affinity/redaction helpers are underscore-based. Change the outbound native header and make internal readers accept both during migration; tests should assert that the final backend request contains only `session-id` in native mode. Upstream's earlier v1.3.0 code used neither hook spelling consistently enough to override the explicit fix commit.
- **Model allow/hide semantics:** v1.17.18 allows `gpt-5.5`, Spark, 5.4, 5.4-mini, and future versions above 5.4, while hiding 5.5 Pro and removing sunset GPT-5.2/5.3 Codex entries. [Sunset removal](https://github.com/anomalyco/opencode/commit/4668db8fa2eb043ca3cdc895877e7c0657135beb) and [5.5 Pro exclusion](https://github.com/anomalyco/opencode/commit/c5a4a8288cbe115f673f3f9933fe217402c85406). Local account-scoped live-catalog filtering is safer than copying this heuristic, but native mode must not re-expose a model the authoritative catalog marks hidden/unsupported, and fallback data must not fabricate eligibility.
- **Refresh races:** upstream now shares concurrent refresh work. Local rotation can issue simultaneous requests against one account, so refresh dedupe must be keyed by strict identity (`accountId|email|plan`) and must not merge refreshes across accounts or native/codex auth domains.
- **Dependency/API drift:** the development dependency baseline is now `@opencode-ai/plugin` and `@opencode-ai/sdk` `^1.17.18`. The published plugin declaration's missing `HeadersInit` qualification is handled by the existing narrow declaration patch, and config helpers consume the plugin package's expanded tuple-aware `Config` type.

### Medium

- **Retry/error classification expanded:** session retry now treats unmarked 5xx responses as retryable, recognizes additional OpenAI retry cases, and retries `server_is_overloaded`/`server_error`. [5xx fix](https://github.com/anomalyco/opencode/commit/4ca809ef4e71ee6d62990c815c82c7ee57395a8b), [OpenAI case](https://github.com/anomalyco/opencode/commit/334ab4707c809172e77619ae7d6b22c5577c7238), and [overload fix](https://github.com/anomalyco/opencode/commit/25ecf0af6b8a022d284f9a5a9e9155ced6a37041). Local fetch orchestration specializes in bounded 429 account switching; host-level 5xx/stream retry should remain the default owner unless this plugin consumes and hides the response. Add contract tests, not a second unbounded retry loop.
- **Request transforms evolved:** OpenAI-family requests continue to default `store: false`, use session-derived `promptCacheKey`, gate reasoning summaries to compatible providers, and clear max output tokens in the Codex plugin. [Fast/service-tier support](https://github.com/anomalyco/opencode/commit/b0600664abacabc3b6d41de88859248bc2a2594), [reasoning-summary gate](https://github.com/anomalyco/opencode/commit/cc487dd032ebed11bac5694210adcbd0b3db2399), and [Codex max-token ownership](https://github.com/anomalyco/opencode/commit/48c1b6b3387647edfde931c3a50a325c37245b06). Local transforms already implement these concepts; verify exact final payloads after the SDK bump.
- **WebSocket transport:** adopting it would change lifecycle, retry, endpoint, header stripping, and title-generation behavior. Treat it as a separate feature with HTTP fallback and transport-specific tests, not incidental sync work.

### Low / architectural

- Core/Effect/schema/module-barrel moves, branded IDs, shared OAuth HTML, logger replacement, and Node server conversion do not alter this plugin's external native identity contract by themselves.
- Zero subscription pricing is UI/accounting behavior in OpenCode's resolved provider catalog. It does not change Codex billing or this plugin's account rotation.

## Parity gap assessment against this repo

| Area | Assessment |
|---|---|
| OAuth authorize/device flow | **Aligned:** issuer/client, loopback callback, PKCE/state, device endpoint, polling safety margin, account-ID extraction, and native `opencode/<version>` device UA are represented locally. Local multi-account persistence intentionally exceeds upstream. |
| Request identity | **Aligned:** final hooks emit `session-id`; legacy `session_id` remains an inbound/redaction compatibility alias. Originator and native UA remain aligned. |
| Endpoint routing | **Aligned for HTTP:** both Responses and Chat Completions are rewritten to the Codex Responses backend. |
| Model catalog | **Mostly aligned and intentionally richer:** local live account-scoped Codex metadata plus tagged GitHub fallback is stronger than upstream's models.dev-based hook. Confirm hidden/API-support filtering and never clone metadata across slugs. |
| Model visibility | **Aligned by stronger authority:** local behavior follows account-scoped live catalog visibility/support fields and refuses to grant Ultra eligibility from GitHub fallback metadata. It intentionally does not copy OpenCode's version heuristic. |
| Refresh | **Aligned by stronger isolation:** catalog fetches are single-flight and account refresh/persistence remains lock-guarded by strict identity. Upstream's single-record global promise is not copied across rotating accounts. |
| Retry/error | **Layering gap, not necessarily code gap:** local bounded 429 rotation is intentional; verify host 5xx and OpenAI `server_error`/`server_is_overloaded` semantics survive unchanged. |
| GPT-5.6 Ultra | **No OpenCode parity gap:** upstream has no literal Ultra contract. Local logical Ultra normalization is an extension and should remain isolated from native request identity and authorized only by live catalog metadata. |
| WebSockets | **Optional gap:** v1.17.18 has experimental Responses WebSockets; local HTTP-only behavior remains valid unless feature parity is explicitly desired. |
| Plugin lifecycle | **Aligned:** `dispose` stops the instance's proactive-refresh scheduler and composes any Codex-layer cleanup. |
| Upstream watcher | **Aligned:** paths and hashes target v1.17.18, including the moved Codex plugin, models.dev core, and optional WebSocket transport files. Source-filtered checks allow OpenCode to advance independently of Codex path drift. |

## Implementation disposition

### Completed now

1. Changed outbound identity from `session_id` to `session-id`; affinity, redirect stripping, snapshots/redaction, and tests accept legacy input where needed while generated hooks emit only the canonical header.
2. Updated the upstream watch and sync guide to v1.17.18 paths/hashes, including `plugin/openai/codex.ts`, `packages/core/src/models-dev.ts`, `ws.ts`, and `ws-pool.ts`.
3. Preserved the account-scoped live Codex catalog as the stronger authority for visibility, defaults, and Ultra eligibility; GitHub fallback metadata remains fail-closed for Ultra.
4. Upgraded `@opencode-ai/plugin` and `@opencode-ai/sdk` to `^1.17.18`, adapted the narrow declaration shim and config type boundary, and passed full type/test/build verification.
5. Composed the new plugin `dispose` hook to stop proactive-refresh timers without allowing disposal of an older instance to clear a newer instance's scheduler.

### Optional follow-up

- Prototype experimental Responses WebSockets behind an explicit opt-in. Match upstream pooling/disposal, custom base URL, title HTTP fallback, internal-header stripping, stream retry, and idle handling before enabling it by default.
- Track upstream's models.dev/core catalog only for OpenCode host compatibility; keep the live account-scoped Codex catalog authoritative for Codex defaults and Ultra eligibility.
- Add a documented ownership matrix: host retries transport/5xx errors; this plugin rotates accounts only for bounded 429/auth cases; neither layer silently multiplies attempts.

### No action

- Do not move local files merely to mirror upstream paths.
- Do not replace multi-account storage with upstream's single OpenAI auth record.
- Do not synthesize a GPT-5.6 model or infer Ultra from a model-name/version heuristic.
- Do not port core Effect/logging/schema refactors unless required by a public plugin/SDK API change.
- Do not enable WebSockets solely because upstream colocated the Codex plugin under `plugin/openai/`.
- Do not move runtime settings into OpenCode's plugin option tuple; preserve `opencode.json` for installation and `codex-config.jsonc` for behavior.

## Primary-source reference index

- Tagged Codex plugin: [v1.3.0](https://github.com/anomalyco/opencode/blob/v1.3.0/packages/opencode/src/plugin/codex.ts), [v1.17.18](https://github.com/anomalyco/opencode/blob/v1.17.18/packages/opencode/src/plugin/openai/codex.ts)
- Catalog/model implementation: [v1.3.0 provider/models.ts](https://github.com/anomalyco/opencode/blob/v1.3.0/packages/opencode/src/provider/models.ts), [v1.17.18 core/models-dev.ts](https://github.com/anomalyco/opencode/blob/v1.17.18/packages/core/src/models-dev.ts), [move commit](https://github.com/anomalyco/opencode/commit/16c457e71233b2eca6a73aa292ec1ed225d87af7)
- OpenAI transport: [WebSocket pool](https://github.com/anomalyco/opencode/blob/v1.17.18/packages/opencode/src/plugin/openai/ws-pool.ts), [WebSocket protocol adapter](https://github.com/anomalyco/opencode/blob/v1.17.18/packages/opencode/src/plugin/openai/ws.ts)
- Provider/session behavior: [transform.ts](https://github.com/anomalyco/opencode/blob/v1.17.18/packages/opencode/src/provider/transform.ts), [error.ts](https://github.com/anomalyco/opencode/blob/v1.17.18/packages/opencode/src/provider/error.ts), [retry.ts](https://github.com/anomalyco/opencode/blob/v1.17.18/packages/opencode/src/session/retry.ts)
- Release/tag comparison: [v1.3.0...v1.17.18](https://github.com/anomalyco/opencode/compare/v1.3.0...v1.17.18)
