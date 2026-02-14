# Upstream Sync

Track the OpenCode and Codex releases this plugin is aligned to, and how to keep parity with upstream native Codex behavior.

## Current baseline

- OpenCode release: `v1.2.2`
- Upstream repo: `https://github.com/anomalyco/opencode`
- Baseline tag commit: `3b6b3e6fc8a8a4da5798c9f00027e954263a483e`
- Upstream HEAD inspected: `67c985ce82b3a0ef3b22bef435f58884a3aab990`
- Native Codex reference file: `packages/opencode/src/plugin/codex.ts`
- Codex upstream repo: `https://github.com/openai/codex`
- Codex upstream release track: `rust-v0.101.0`
- Local dependency target:
  - `@opencode-ai/plugin`: `^1.2.2`
  - `@opencode-ai/sdk`: `^1.2.2`

## Latest parity audit (2026-02-14)

- Verified OAuth constants and authorize URL semantics against upstream `codex.ts`.
- Verified native callback URI now uses `http://localhost:1455/auth/callback`.
- Verified native headless device-auth requests use `User-Agent: opencode/<version>`.
- Verified request routing parity for `/v1/responses` and `/chat/completions` to Codex responses endpoint.
- Parity tests live in `test/codex-native-oauth-parity.test.ts`.

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
- Scheduled CI watcher: `.github/workflows/upstream-watch.yml` (weekly + manual dispatch)

Tracked upstream surfaces include:

- Codex plugin: `packages/opencode/src/plugin/codex.ts`
- Plugin wiring: `packages/opencode/src/plugin/index.ts`
- Provider core: `packages/opencode/src/provider/provider.ts`, `packages/opencode/src/provider/auth.ts`
- Provider transforms/schema/error handling: `packages/opencode/src/provider/transform.ts`, `packages/opencode/src/provider/models.ts`, `packages/opencode/src/provider/error.ts`
- Session-side OpenAI stream error handling: `packages/opencode/src/session/message-v2.ts`
- Codex upstream model/auth/runtime files: `codex-rs/core/models.json`, `codex-rs/core/src/auth.rs`, `codex-rs/core/src/client.rs`, `codex-rs/core/src/codex.rs`, `codex-rs/core/src/compact.rs`

All automated upstream checks fetch directly from GitHub release tags (`api.github.com` and `raw.githubusercontent.com`).
No local upstream clones are required for drift detection.

When drift is detected, the workflow uploads a report artifact and opens/updates a maintenance issue.

## Notes

- `mode: "native"` remains a carbon-copy behavior target for identity/header semantics.
- This repo intentionally adds account manager UX, account rotation, and lock-safe account persistence beyond upstream native plugin behavior.
