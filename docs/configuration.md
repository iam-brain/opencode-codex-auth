# Configuration

This plugin uses one runtime config file:

- resolved config path:
  - `$XDG_CONFIG_HOME/opencode/codex-config.jsonc` when `XDG_CONFIG_HOME` is set
  - otherwise `~/.config/opencode/codex-config.jsonc`

If the default config path does not exist, installer/bootstrap flows create it with defaults.

If `OPENCODE_OPENAI_MULTI_CONFIG_PATH` is set, that explicit file path is loaded for runtime behavior. You are responsible for creating/managing that file.

Note: plugin startup still ensures the default config file exists as a bootstrap convenience, even when runtime reads from an explicit `OPENCODE_OPENAI_MULTI_CONFIG_PATH`.

## Path exceptions

Most plugin-managed files follow resolved config roots (`$XDG_CONFIG_HOME/opencode/...` when set, otherwise `~/.config/opencode/...`).

Known exceptions:

- OpenCode provider auth marker/legacy transfer source is OpenCode-owned at `${XDG_DATA_HOME:-~/.local/share}/opencode/auth.json`.

## JSON schemas

Use these schemas for validation/autocomplete:

- `schemas/codex-config.schema.json` -> `codex-config.jsonc`
- `schemas/opencode.schema.json` -> `opencode.json`
- `schemas/codex-accounts.schema.json` -> `codex-accounts.json` (advanced/manual recovery only)

## Config path resolution

The plugin loads config in this order:

1. `OPENCODE_OPENAI_MULTI_CONFIG_PATH`
2. Resolved default config path:
   - `$XDG_CONFIG_HOME/opencode/codex-config.jsonc` when `XDG_CONFIG_HOME` is set
   - otherwise `~/.config/opencode/codex-config.jsonc`
   - compatibility fallback: `codex-config.json` if the canonical `.jsonc` file is absent

`codex-config.jsonc` supports JSON comments (`//` and `/* ... */`) for readability. The loader also accepts commented legacy `codex-config.json` files.

Known-field type validation is applied on load. If a known field has an invalid type/value, the plugin ignores that config file and logs an actionable warning.

## Default generated config

```jsonc
{
  "$schema": "https://schemas.iam-brain.dev/opencode-codex-auth/codex-config.schema.json",
  "debug": false,
  "quiet": false,
  "refreshAhead": {
    "enabled": true,
    "bufferMs": 60000
  },
  "runtime": {
    "mode": "native",
    "rotationStrategy": "sticky",
    "sanitizeInputs": false,
    "developerMessagesToUser": true,
    "promptCacheKeyStrategy": "default",
    "headerSnapshots": false,
    "headerSnapshotBodies": false,
    "headerTransformDebug": false,
    "ultra": false,
    "pidOffset": false
  },
  "global": {
    "personality": "pragmatic",
    "reasoningSummary": "auto",
    "textVerbosity": "default"
  },
  "customModels": {},
  "perModel": {}
}
```

Mode-derived runtime defaults when omitted:

- `runtime.codexCompactionOverride`: `true` in `codex`, `false` in `native`
- `runtime.ultra`: `false` in every mode
- `runtime.ultraReasoningEffort`: `"max"` in every mode

## Settings reference

### Top-level

- `debug: boolean`
  - Enables plugin debug logging (`false` default).
- `quiet: boolean`
  - Suppresses plugin toast/UI notifications (`false` default).
- `refreshAhead.enabled: boolean`
  - Enables proactive token refresh (`true` default).
- `refreshAhead.bufferMs: number`
  - Refresh lead time in milliseconds before expiry (`60000` default).

### Runtime

- `runtime.mode: "native" | "codex"`
  - `native`: carbon-copy target of standard OpenCode native plugin identity/header behavior.
  - `codex`: full codex-rs spoof identity/header behavior.
- `runtime.rotationStrategy: "sticky" | "hybrid" | "round_robin"`
  - `sticky`: one active account until limits/health require change (default).
  - `hybrid`: prefers active account, falls back to healthiest/LRU behavior.
  - `round_robin`: rotates every message (higher token/cache churn).
- `runtime.sanitizeInputs: boolean`
  - Sanitizes outbound payloads for provider-compat edge cases.
- `runtime.developerMessagesToUser: boolean`
  - When effective spoof mode is `codex`, remaps non-permissions `developer` messages to `user` (`true` default).
  - Preserves permissions/bootstrap developer blocks (for example `<permissions instructions>` content) even when remap is enabled.
  - Set to `false` to preserve all `developer` roles.
- `runtime.promptCacheKeyStrategy: "default" | "project"`
  - `default`: preserve upstream `prompt_cache_key` behavior (session-based keying).
  - `project`: override `prompt_cache_key` with a versioned hash of project path + mode.
- `runtime.codexCompactionOverride: boolean`
  - Enables codex-rs compact prompt + `summary_prefix` handoff behavior for OpenAI sessions.
  - Mode defaults: `true` in `codex`, `false` in `native`.
  - Explicit boolean value overrides mode default.
- `runtime.shareableDebug: boolean`
  - Writes a bounded privacy-first summary log to `<config-root>/logs/codex-plugin/shareable-debug.jsonl`.
  - Persists a rolling crash-tolerant event buffer under `<config-root>/logs/codex-plugin/shareable-debug-state/segments/`.
  - On trigger conditions (`401`, `403`, `429`, auth failures, account-switch retry after failure, and synthetic plugin fatal errors), writes a dedicated incident file under `<config-root>/logs/codex-plugin/shareable-debug-state/incidents/`.
  - Uses `<config-root>/logs/codex-plugin/shareable-debug-state/incident-state.json` to resume or seal interrupted incident capture after restart.
  - Sensitive identifiers are pseudonymized per process/log bundle instead of logged raw.
  - Request bodies, tokens, cookies, OAuth secrets, raw emails/account IDs/session IDs, and raw `prompt_cache_key` values are never persisted by this mode.
  - When enabled, request snapshot logging is suppressed even if `runtime.headerSnapshots` or `runtime.headerTransformDebug` are also set.
- `runtime.headerSnapshots: boolean`
  - Writes before/after request header snapshots to debug logs.
  - Custom snapshot metadata is stored under a nested `meta` object to prevent collisions with reserved top-level fields.
- `runtime.headerSnapshotBodies: boolean`
  - When `runtime.headerSnapshots=true`, includes redacted request bodies in snapshots.
  - Response snapshots include status + headers only (no response body capture).
  - Caution: request body snapshots can still contain prompt/tool payload content even when token fields are redacted.
- `runtime.headerTransformDebug: boolean`
  - Adds explicit `before-header-transform` and `after-header-transform` request snapshots for message fetches.
- `runtime.pidOffset: boolean`
  - Enables session-aware offset behavior for account selection.
- `runtime.ultra: boolean`
  - Work in progress. Enables the catalog-gated Ultra agent mode.
  - Defaults to `false`; it must be explicitly enabled in any runtime mode.
  - When disabled, the `ultra` picker variant is hidden and no delegation policy is injected. Stale literal `ultra` inputs still degrade safely to wire effort `max`.
- `runtime.ultraReasoningEffort: "low" | "medium" | "high" | "xhigh" | "max"`
  - Selects the inference effort sent while logical Ultra mode is active.
  - Defaults to `"max"`, matching official Codex. Lower values retain Ultra's proactive multi-agent policy while reducing inference reasoning effort.

### Model behavior

- Model availability comes from the selected catalog source for the current account.
- When a live account-scoped `/backend-api/codex/models` fetch succeeds, the plugin uses that source alone after normalizing, deduplicating, and sorting the catalog response for provider shaping.
- When live catalog data is unavailable, the plugin falls back to the shared GitHub `models.json` snapshot, normalized through the same catalog parser.
- The plugin does not field-merge live catalog entries with GitHub fallback entries.
- Do not rely on a static model list: GPT-5.6-era models and variants are sourced from the authenticated account's live catalog when that fetch succeeds, or from the shared GitHub snapshot when live catalog data is unavailable.
- Actual availability still depends on the authenticated account's live catalog and plan entitlements.

- `global.personality: string`
  - Personality key applied to all models unless overridden.
- `global.reasoningEffort: string` (optional)
  - Global reasoning effort override forwarded upstream when the request does not already set one.
  - When omitted, the selected model's live catalog `default_reasoning_level` is used, typically `"medium"`.
  - User config can still override reasoning effort globally, per model, or per variant.
- `ultra` reasoning variant
  - Work in progress and available only when `runtime.ultra=true` and the active model advertises `ultra` with `multi_agent_version: "v2"`.
  - `codex` mode adds the official Codex proactive multi-agent mode guidance to eligible root and inherited Ultra child turns; `native` mode preserves OpenCode-native prompt identity.
  - Correlated Ultra selections remain safe on unsupported or stale catalogs: the backend request sends the configured Ultra reasoning effort, defaulting to `max`, without proactive delegation. An uncorrelated literal `ultra` fails closed to wire `max`.
  - There is no public concurrency setting; OpenCode remains responsible for agent execution and lifecycle.
- `global.reasoningMode: "standard" | "pro"` (optional)
  - GPT-5.6 reasoning mode, emitted as `reasoning.mode` independently of `reasoning.effort`.
  - An explicit request value is preserved. The same per-model and per-variant precedence applies.
- `global.reasoningSummary: "auto" | "concise" | "detailed" | "none"`
  - Global reasoning summary format override forwarded upstream as `reasoning.summary`.
  - `"none"` disables reasoning summaries.
  - Deprecated boolean aliases still load:
    - `reasoningSummaries: true` => `"auto"`
    - `reasoningSummaries: false` => `"none"`
    - `thinkingSummaries` behaves the same way and warns on load.
- `global.textVerbosity: "default" | "low" | "medium" | "high" | "none"`
  - Global text verbosity override forwarded upstream as `text.verbosity`.
  - `"default"` uses each model catalog default.
  - `"none"` disables text verbosity.
  - Deprecated aliases still load:
    - `verbosityEnabled: false` => `"none"`
    - `verbosity: "medium"` => `textVerbosity: "medium"`
- `global.serviceTier: "auto" | "priority" | "flex"`
  - Global speed-tier preference (`serviceTier`).
  - `"priority"` maps to request-body `service_tier: "priority"` only when the selected model's active catalog entry advertises the `priority` service tier.
  - `"flex"` passes through `service_tier: "flex"`.
  - `"auto"` or omission leaves `service_tier` unset unless the request body already sets it.
  - Deprecated alias: `"default"` => `"auto"`.
- `global.include: ("reasoning.encrypted_content" | "file_search_call.results" | "message.output_text.logprobs")[]`
  - Global response include values merged into host-provided `include`.
- `global.parallelToolCalls: boolean`
  - Global override for `parallel_tool_calls` when the request does not already set one.
- `customModels.<slug>.targetModel: string`
  - Required target model slug inherited by the selectable custom model alias.
- `customModels.<slug>.name: string`
  - Optional display name for the custom selectable model.
- `customModels.<slug>.personality`, `customModels.<slug>.reasoningEffort`, `customModels.<slug>.reasoningSummary`, `customModels.<slug>.textVerbosity`, `customModels.<slug>.serviceTier`, `customModels.<slug>.include`, `customModels.<slug>.parallelToolCalls`
  - Defaults applied when that custom slug is selected.
- `customModels.<slug>.variants.<variant>.personality`
  - Variant-level override for the selected custom slug.
- `customModels.<slug>.variants.<variant>.reasoningEffort`, `customModels.<slug>.variants.<variant>.reasoningSummary`, `customModels.<slug>.variants.<variant>.textVerbosity`, `customModels.<slug>.variants.<variant>.serviceTier`, `customModels.<slug>.variants.<variant>.include`, `customModels.<slug>.variants.<variant>.parallelToolCalls`
  - Variant-level overrides for the selected custom slug.
- `perModel.<model>.personality: string`
  - Model-specific personality override.
- `perModel.<model>.reasoningEffort`, `perModel.<model>.reasoningSummary`, `perModel.<model>.textVerbosity`, `perModel.<model>.serviceTier`, `perModel.<model>.include`, `perModel.<model>.parallelToolCalls`
  - Model-specific overrides with the same semantics as `global.*`.
- `perModel.<model>.variants.<variant>.personality: string`
  - Variant-level personality override.
- `perModel.<model>.variants.<variant>.reasoningEffort`, `perModel.<model>.variants.<variant>.reasoningSummary`, `perModel.<model>.variants.<variant>.textVerbosity`, `perModel.<model>.variants.<variant>.serviceTier`, `perModel.<model>.variants.<variant>.include`, `perModel.<model>.variants.<variant>.parallelToolCalls`
  - Variant-level overrides with the same semantics as `global.*`.

If a model reports `supportsVerbosity=false` in catalog/runtime defaults, verbosity overrides are ignored.

Precedence for `personality`, `reasoningEffort`, `reasoningMode`, `reasoningSummary`, `textVerbosity`, `serviceTier`, `include`, and `parallelToolCalls` settings:

1. `perModel.<model>.variants.<variant>`
2. `perModel.<model>`
3. `customModels.<selected-slug>.variants.<variant>`
4. `customModels.<selected-slug>`
5. `global`
6. selected model live catalog defaults, including `default_reasoning_level` for reasoning effort when no user override is configured

Custom model notes:

- `customModels` creates selectable aliases like `openai/my-fast-codex`.
- The selected custom slug inherits instructions, runtime defaults, capabilities, limits, and supported variants from `targetModel`.
- The backend request still uses `targetModel` as the API model id.
- If `targetModel` is not present in the active catalog/provider, the plugin warns and skips that custom model instead of inventing metadata.
- `reasoningSummaryFormat` remains internal-only. Users control request summaries with `reasoningSummary`; internal catalog defaults may still populate `reasoning.summary` when no explicit config override is set.

### Generated Fast, 1M, and Pro models

- `modelAliases.fast` defaults to `true`. Any catalog model advertising priority/Fast gets a separate `[Model Name] Fast` provider model routed to the canonical slug with `service_tier: "priority"`.
- `modelAliases.extendedContext` defaults to `true`. Models advertising a larger `max_context_window` get `[Model Name] 1M`. GPT-5.6 Sol/Terra/Luna use the official 1,050,000 context, 922,000 max input, and 128,000 max output contract even while a Codex catalog reports a smaller normal window.
- `modelAliases.pro` defaults to `false` for ChatGPT OAuth and `true` for API-key auth. Explicit `true` or `false` overrides the auth-aware default.
- `[Model Name] Pro` is the same canonical GPT-5.6 Sol/Terra/Luna slug with `reasoning: { mode: "pro" }`; effort remains independently selectable.
- Fast, 1M, and Pro are three separate aliases. The plugin does not create combination aliases.
- API-key handling is limited to cloning/routing provider entries; OAuth storage, rotation, refresh, and API-key authentication remain unchanged.
- Account-scoped catalog responses remain authoritative. The plugin does not copy metadata across canonical slugs.

### GPT-5.4 long context

- The plugin preserves an explicit request-body `service_tier` if your host already sets one.
- The plugin preserves request-level `model_context_window`, `model_auto_compact_token_limit`, and `max_output_tokens` fields through all payload rewrites.
- For `gpt-5.4*`, the plugin clamps those request-level overrides to the currently documented GPT-5.4 long-context limits before sending the request:
  - `model_context_window <= 1,050,000`
  - `model_auto_compact_token_limit <= min(922,000, model_context_window - 128,000)`
  - `max_output_tokens <= 128,000`
- The `922,000` auto-compact ceiling is the full-window practical safe-input cap derived from the published `1,050,000` total context budget minus the published `128,000` max output budget.
- If you request a smaller `model_context_window`, the plugin also preserves the same output headroom by clamping `model_auto_compact_token_limit` to `model_context_window - 128,000`.
- The live Codex catalog currently still reports `context_window: 272000` for `gpt-5.4`, so any larger `model_context_window` value is an explicit request override rather than a catalog default.
- OpenAI's current GPT-5.4 guidance says prompts above the standard `272,000` input window are billed at higher long-context rates.

## Personality system

Built-in personalities from model metadata:

- `friendly`
- `pragmatic`

Custom personalities:

- Store files in:
  - project-local: `.opencode/personalities/<key>.md`
  - global: `$XDG_CONFIG_HOME/opencode/personalities/<key>.md` when `XDG_CONFIG_HOME` is set, otherwise `~/.config/opencode/personalities/<key>.md`
- Key format:
  - lowercase safe slug (no `/`, `\`, or `..`)
- Pattern recommendation (same shape as native-friendly/pragmatic behavior):
  - keep a stable "core assistant contract" (coding agent, safety, correctness, no fabricated output)
  - layer style/tone/collaboration preferences under separate sections
  - add explicit guardrails and anti-patterns

### `/create-personality` workflow

Installer and startup bootstrap a slash command:

- `/create-personality`

And a tool:

- `create-personality`

And a managed skill bundle:

- `$XDG_CONFIG_HOME/opencode/skills/personality-builder/SKILL.md` when `XDG_CONFIG_HOME` is set, otherwise `~/.config/opencode/skills/personality-builder/SKILL.md`

Flow:

1. Run `/create-personality`.
2. The assistant interviews you (inspiration, tone, coding style, guardrails, examples).
3. The assistant calls `create-personality`.
4. A new profile is written under `personalities/<key>.md`.
5. Set the key in `codex-config.jsonc` via `global.personality` or `perModel`.

Advanced path:

1. Use the `personality-builder` skill when you want stricter voice/protocol extraction from source docs.
2. Follow the skill workflow, then persist through `create-personality`.

## Why `runtime.mode` exists (and no `identityMode`)

- `runtime.mode` is the canonical persisted mode setting in `codex-config.jsonc`.
- Identity behavior is derived from mode:
  - `native` -> native identity
  - `codex` -> codex identity
- `spoofMode` is compatibility plumbing, not a canonical config key.

## Environment variables

### Config/mode overrides

- `OPENCODE_OPENAI_MULTI_CONFIG_PATH`: explicit config file path (absolute path recommended).
- `OPENCODE_OPENAI_MULTI_REASONING_SUMMARIES`: global reasoning-summary env override.
- `OPENCODE_OPENAI_MULTI_THINKING_SUMMARIES`: deprecated alias for `OPENCODE_OPENAI_MULTI_REASONING_SUMMARIES`.
- `OPENCODE_OPENAI_MULTI_MODE`: `native|codex`.
- `OPENCODE_OPENAI_MULTI_SPOOF_MODE`: advanced temporary identity override (`native|codex`).
  - If `OPENCODE_OPENAI_MULTI_MODE` is set, runtime mode takes precedence.
- `XDG_CONFIG_HOME`: changes config/agents/personality roots.

### Runtime overrides

- `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_PROACTIVE_REFRESH_BUFFER_MS`: integer ms.
- `OPENCODE_OPENAI_MULTI_QUIET`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_PID_OFFSET`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_ROTATION_STRATEGY`: `sticky|hybrid|round_robin`.
- `OPENCODE_OPENAI_MULTI_PROMPT_CACHE_KEY_STRATEGY`: `default|project`.
- `OPENCODE_OPENAI_MULTI_PERSONALITY`: personality key override.
- `OPENCODE_OPENAI_MULTI_THINKING_SUMMARIES`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_TEXT_VERBOSITY`: `default|low|medium|high|none`.
- `OPENCODE_OPENAI_MULTI_VERBOSITY_ENABLED`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_VERBOSITY`: `default|low|medium|high`.
- `OPENCODE_OPENAI_MULTI_SERVICE_TIER`: `default|priority|flex`.
- `OPENCODE_OPENAI_MULTI_COMPAT_INPUT_SANITIZER`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_REMAP_DEVELOPER_MESSAGES_TO_USER`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_CODEX_COMPACTION_OVERRIDE`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOT_BODIES`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_HEADER_TRANSFORM_DEBUG`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_ULTRA`: `1|0|true|false` (WIP; defaults to false).
- `OPENCODE_OPENAI_MULTI_ULTRA_REASONING_EFFORT`: `low|medium|high|xhigh|max` (defaults to `max`).

### Debug/OAuth controls

- `OPENCODE_OPENAI_MULTI_DEBUG=1`: plugin debug logs.
- `OPENCODE_OPENAI_MULTI_SHAREABLE_DEBUG=1`: privacy-first shareable structured debug log.
- `CODEX_IN_VIVO=1`: enables live quota probe tests.
- `DEBUG_CODEX_PLUGIN=1`: alternate debug flag.
- `CODEX_AUTH_DEBUG=1`: verbose OAuth lifecycle logging (`oauth-lifecycle.log`).
  - Accepted truthy values: `1`, `true`, `yes`, `on`.
  - This flag is independent from general plugin debug flags.
- `CODEX_AUTH_DEBUG_MAX_BYTES`: max size for `oauth-lifecycle.log` before rotation to `oauth-lifecycle.log.1`.
- `CODEX_OAUTH_CALLBACK_TIMEOUT_MS`: OAuth wait timeout (min `60000`).
- `CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS`: success-page shutdown grace.
- `CODEX_OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS`: error-page shutdown grace.
- `CODEX_OAUTH_HTTP_TIMEOUT_MS`: timeout for OAuth HTTP calls (ms, min `1000`).
- OAuth HTTP requests reject redirects by default for token/code exchange safety.
- `CODEX_DEVICE_AUTH_TIMEOUT_MS`: max total device-auth polling time (ms, min `1000`).
- `OPENCODE_NO_BROWSER=1`: disables browser auto-open.
- `NO_COLOR=1`: disables ANSI color blocks in quota UI.

## Legacy keys

Legacy behavior keys are no longer parsed from `codex-config.jsonc`.

- `personality`
- `customSettings` and all nested `customSettings.*`

Use canonical `global` and `perModel` keys only.

## Legacy orchestrator cleanup

The removed orchestrator WIP no longer downloads prompts, injects collaboration headers, or manages an `orchestrator.md` agent. On startup and installer runs, the plugin removes its legacy prompt-cache files and removes legacy agent files only when they contain the plugin-managed orchestrator marker; user-authored files are preserved.
