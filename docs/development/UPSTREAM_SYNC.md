# Upstream Sync

Track the OpenCode and Codex releases this plugin is aligned to, and how to keep parity with upstream native Codex behavior.

## Current baseline

- OpenCode release: `v1.17.18`
- Upstream repo: `https://github.com/anomalyco/opencode`
- Baseline tag commit: tracked in `docs/development/upstream-watch.json`
- Upstream HEAD inspected: GitHub latest release/tag via `npm run check:upstream`
- Native Codex reference file: `packages/opencode/src/plugin/openai/codex.ts`
- Codex upstream repo: `https://github.com/openai/codex`
- Codex upstream release track: `rust-v0.144.1` for the GPT-5.6 Ultra contract
- Local dependency target:
  - `@opencode-ai/plugin`: `^1.17.18`
  - `@opencode-ai/sdk`: `^1.17.18`

## Latest parity audit (2026-07-10)

- Verified OAuth constants and authorize URL semantics against upstream `codex.ts`.
- Verified native callback URI now uses `http://localhost:1455/auth/callback`.
- Verified native headless device-auth requests use `User-Agent: opencode/<version>`.
- Verified request routing parity for `/v1/responses` and `/chat/completions` to Codex responses endpoint.
- Verified live Codex model payload now includes `default_reasoning_summary` and newer GPT-5.4-era catalog metadata in addition to `display_name`, `priority`, and `supports_parallel_tool_calls`.
- Verified default prompt caching remains upstream-owned: OpenCode sets `promptCacheKey` from `sessionID`, and Codex sends `prompt_cache_key` from the active conversation ID.
- Verified GPT-5.4 fast mode remains request-body `service_tier: "priority"`; no new HTTP priority header is used on the normal request path.
- Updated normal HTTP request parity for both `native` and `codex` modes to use canonical `session-id`; legacy `session_id` remains accepted as an inbound compatibility alias and in snapshot redaction.
- Verified OpenCode's new Responses WebSocket transport remains experimental and optional. This plugin continues to use the supported HTTP path and now watches the upstream transport files for future stabilization.
- Integrated OpenCode's plugin lifecycle contract by composing `dispose` to stop the proactive-refresh scheduler. The v1 module-object export and plugin option tuples remain optional; the function export preserves older-host compatibility and runtime settings remain in `codex-config.jsonc`.
- Verified OpenCode's OAuth model filter is catalog-driven. This plugin retains its stricter account-scoped live Codex catalog authority and does not synthesize metadata across model slugs.
- Verified concurrent catalog fetches are deduplicated and account refreshes remain lock-guarded by strict account identity in this plugin's multi-account architecture.
- Verified the plugin now uses Codex `default_reasoning_summary` instead of treating `reasoning_summary_format` as the default summary value.
- Detailed findings and dispositions are in `docs/development/OPENCODE_V1_17_18_SYNC.md`.
- Parity tests live in `test/codex-native-oauth-parity.test.ts`, `test/codex-native-spoof-mode.test.ts`, and `test/upstream-watch-config.test.ts`.

## Sync checklist

1. Check latest OpenCode release tag.
2. Check latest Codex release tag (`openai/codex`).
3. Compare tracked upstream files with this repo's mapped local modules.
4. Port upstream behavioral deltas while preserving this plugin's multi-account and storage invariants.
5. Bump `@opencode-ai/plugin` and `@opencode-ai/sdk` in `package.json` when OpenCode changes require it.
6. Run `npm run verify`.
7. Run a manual smoke check (`opencode auth login`, then one `openai/*` request).

## Automated watch

- Tracked file manifest: `docs/development/upstream-watch.json`
- Local check command: `npm run check:upstream`
- Baseline refresh command (after parity update): `npm run check:upstream:update`
- OpenCode-only check/update commands: `npm run check:upstream:opencode`, `npm run check:upstream:opencode:update`
- Scheduled CI watcher: `.github/workflows/upstream-watch.yml` (weekly + manual dispatch)

Tracked upstream surfaces include:

- Codex plugin: `packages/opencode/src/plugin/openai/codex.ts`
- Experimental OpenAI transport: `packages/opencode/src/plugin/openai/ws.ts`, `packages/opencode/src/plugin/openai/ws-pool.ts`
- Plugin wiring: `packages/opencode/src/plugin/index.ts`
- Provider core: `packages/opencode/src/provider/provider.ts`, `packages/opencode/src/provider/auth.ts`
- Provider transforms/schema/error handling: `packages/opencode/src/provider/transform.ts`, `packages/core/src/models-dev.ts`, `packages/opencode/src/provider/error.ts`
- Session-side OpenAI stream error handling: `packages/opencode/src/session/message-v2.ts`
- Codex upstream model/auth/runtime files: `codex-rs/models-manager/models.json`, `codex-rs/login/src/auth/manager.rs`, `codex-rs/login/src/server.rs`, `codex-rs/core/src/client.rs`, `codex-rs/core/src/session/multi_agents.rs`, `codex-rs/core/src/codex_thread.rs`, `codex-rs/core/src/codex_delegate.rs`, `codex-rs/core/src/compact.rs`

All automated upstream checks fetch directly from GitHub release tags (`api.github.com` and `raw.githubusercontent.com`).
No local upstream clones are required for drift detection.

When drift is detected, the workflow uploads a report artifact and opens/updates a maintenance issue.

## Notes

- `mode: "native"` remains a carbon-copy behavior target for identity/header semantics.
- This repo intentionally adds account manager UX, account rotation, and lock-safe account persistence beyond upstream native plugin behavior.
