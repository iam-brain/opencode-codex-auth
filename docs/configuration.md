# Configuration

This plugin uses one runtime config file:

- resolved config path:
  - `$XDG_CONFIG_HOME/opencode/codex-config.json` when `XDG_CONFIG_HOME` is set
  - otherwise `~/.config/opencode/codex-config.json`

If the default config path does not exist, installer/bootstrap flows create it with defaults.

If `OPENCODE_OPENAI_MULTI_CONFIG_PATH` is set, that explicit file path is loaded for runtime behavior. You are responsible for creating/managing that file.

Note: plugin startup still ensures the default config file exists as a bootstrap convenience, even when runtime reads from an explicit `OPENCODE_OPENAI_MULTI_CONFIG_PATH`.

## Path exceptions

Most plugin-managed files follow resolved config roots (`$XDG_CONFIG_HOME/opencode/...` when set, otherwise `~/.config/opencode/...`).

Known exceptions:

- Snapshot and OAuth debug logs currently write to fixed paths under `~/.config/opencode/logs/codex-plugin/`.
- OpenCode provider auth marker/legacy transfer source is OpenCode-owned at fixed path `~/.local/share/opencode/auth.json`.

## JSON schemas

Use these schemas for validation/autocomplete:

- `schemas/codex-config.schema.json` -> `codex-config.json`
- `schemas/opencode.schema.json` -> `opencode.json`
- `schemas/codex-accounts.schema.json` -> `codex-accounts.json` (advanced/manual recovery only)

## Config path resolution

The plugin loads config in this order:

1. `OPENCODE_OPENAI_MULTI_CONFIG_PATH`
2. Resolved default config path:
   - `$XDG_CONFIG_HOME/opencode/codex-config.json` when `XDG_CONFIG_HOME` is set
   - otherwise `~/.config/opencode/codex-config.json`

`codex-config.json` supports JSON comments (`//` and `/* ... */`) for readability.

Known-field type validation is applied on load. If a known field has an invalid type/value, the plugin ignores that config file and logs an actionable warning.

## Default generated config

```json
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
    "pidOffset": false
  },
  "global": {
    "personality": "pragmatic",
    "verbosityEnabled": true,
    "verbosity": "default"
  },
  "perModel": {}
}
```

Mode-derived runtime defaults when omitted:

- `runtime.codexCompactionOverride`: `true` in `codex`, `false` in `native`
- `runtime.collaborationProfile`: `true` in `codex`, `false` in `native`
- `runtime.orchestratorSubagents`: inherits effective `runtime.collaborationProfile`

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
- `runtime.headerSnapshots: boolean`
  - Writes before/after request header snapshots to debug logs.
- `runtime.headerSnapshotBodies: boolean`
  - When `runtime.headerSnapshots=true`, includes redacted request bodies in snapshots.
  - Response snapshots include status + headers only (no response body capture).
  - Caution: request body snapshots can still contain prompt/tool payload content even when token fields are redacted.
- `runtime.headerTransformDebug: boolean`
  - Adds explicit `before-header-transform` and `after-header-transform` request snapshots for message fetches.
- `runtime.pidOffset: boolean`
  - Enables session-aware offset behavior for account selection.
- `runtime.collaborationProfile: boolean`
  - Experimental: enables Codex-style collaboration mode mapping from agent names (`plan` -> plan mode, `orchestrator` -> code mode profile).
  - If omitted, defaults to `true` in `runtime.mode="codex"` and `false` otherwise.
  - Explicit `true`/`false` works in any mode.
- `runtime.orchestratorSubagents: boolean`
  - Experimental: enables Codex-style subagent header hints for helper agents under collaboration profile mode.
  - If omitted, inherits `runtime.collaborationProfile` effective value.
  - Explicit `true`/`false` works in any mode.

### Model behavior

- `global.personality: string`
  - Personality key applied to all models unless overridden.
- `global.thinkingSummaries: boolean`
  - Global thinking-summary preference. Omit to use model/catalog default.
- `global.verbosityEnabled: boolean`
  - Enables/disables `textVerbosity` injection globally (`true` default).
- `global.verbosity: "default" | "low" | "medium" | "high"`
  - Verbosity preference (`"default"` uses each model catalog default).
- `perModel.<model>.personality: string`
  - Model-specific personality override.
- `perModel.<model>.thinkingSummaries: boolean`
  - Model-specific summary override (`true` force-on, `false` force-off).
- `perModel.<model>.verbosityEnabled: boolean`
  - Model-specific enable/disable for `textVerbosity`.
- `perModel.<model>.verbosity: "default" | "low" | "medium" | "high"`
  - Model-specific verbosity setting.
- `perModel.<model>.variants.<variant>.personality: string`
  - Variant-level personality override.
- `perModel.<model>.variants.<variant>.thinkingSummaries: boolean`
  - Variant-level summary override (`true` force-on, `false` force-off).
- `perModel.<model>.variants.<variant>.verbosityEnabled: boolean`
  - Variant-level enable/disable for `textVerbosity`.
- `perModel.<model>.variants.<variant>.verbosity: "default" | "low" | "medium" | "high"`
  - Variant-level verbosity setting.

If a model reports `supportsVerbosity=false` in catalog/runtime defaults, verbosity overrides are ignored.

Precedence for `personality`, `thinkingSummaries`, and verbosity settings:

1. `perModel.<model>.variants.<variant>`
2. `perModel.<model>`
3. `global`

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
5. Set the key in `codex-config.json` via `global.personality` or `perModel`.

Advanced path:

1. Use the `personality-builder` skill when you want stricter voice/protocol extraction from source docs.
2. Follow the skill workflow, then persist through `create-personality`.

## Why `runtime.mode` exists (and no `identityMode`)

- `runtime.mode` is the canonical persisted mode setting in `codex-config.json`.
- Identity behavior is derived from mode:
  - `native` -> native identity
  - `codex` -> codex identity
- `spoofMode` is compatibility plumbing, not a canonical config key.

## Environment variables

### Config/mode overrides

- `OPENCODE_OPENAI_MULTI_CONFIG_PATH`: explicit config file path (absolute path recommended).
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
- `OPENCODE_OPENAI_MULTI_VERBOSITY_ENABLED`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_VERBOSITY`: `default|low|medium|high`.
- `OPENCODE_OPENAI_MULTI_COMPAT_INPUT_SANITIZER`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_REMAP_DEVELOPER_MESSAGES_TO_USER`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_CODEX_COMPACTION_OVERRIDE`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOTS`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_HEADER_SNAPSHOT_BODIES`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_HEADER_TRANSFORM_DEBUG`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_COLLABORATION_PROFILE`: `1|0|true|false`.
- `OPENCODE_OPENAI_MULTI_ORCHESTRATOR_SUBAGENTS`: `1|0|true|false`.

### Debug/OAuth controls

- `OPENCODE_OPENAI_MULTI_DEBUG=1`: plugin debug logs.
- `DEBUG_CODEX_PLUGIN=1`: alternate debug flag.
- `CODEX_AUTH_DEBUG=1`: verbose OAuth lifecycle logging (`oauth-lifecycle.log`).
  - Accepted truthy values: `1`, `true`, `yes`, `on`.
  - This flag is independent from general plugin debug flags.
- `CODEX_AUTH_DEBUG_MAX_BYTES`: max size for `oauth-lifecycle.log` before rotation to `oauth-lifecycle.log.1`.
- `CODEX_OAUTH_CALLBACK_TIMEOUT_MS`: OAuth wait timeout (min `60000`).
- `CODEX_OAUTH_SERVER_SHUTDOWN_GRACE_MS`: success-page shutdown grace.
- `CODEX_OAUTH_SERVER_SHUTDOWN_ERROR_GRACE_MS`: error-page shutdown grace.
- `CODEX_OAUTH_HTTP_TIMEOUT_MS`: timeout for OAuth HTTP calls (ms, min `1000`).
- `CODEX_DEVICE_AUTH_TIMEOUT_MS`: max total device-auth polling time (ms, min `1000`).
- `OPENCODE_NO_BROWSER=1`: disables browser auto-open.
- `NO_COLOR=1`: disables ANSI color blocks in quota UI.

## Legacy keys

Legacy behavior keys are no longer parsed from `codex-config.json`.

- `personality`
- `customSettings` and all nested `customSettings.*`

Use canonical `global` and `perModel` keys only.

## Managed prompts and orchestrator agent

The plugin synchronizes a pinned upstream Codex orchestrator prompt and plan-mode prompt into a local cache under the resolved config cache root (`$XDG_CONFIG_HOME/opencode/cache/` when `XDG_CONFIG_HOME` is set, otherwise `~/.config/opencode/cache/`):

- `codex-prompts-cache.json`
- `codex-prompts-cache-meta.json` (stores URLs, `lastChecked`, and ETags)

Fetch behavior:

- TTL-based refresh (best-effort; normal requests continue if refresh fails)
- ETag-based revalidation (`If-None-Match` + `304 Not Modified`)

The plan prompt from this cache is used to populate plan-mode collaboration instructions.

When `runtime.collaborationProfile` is enabled, the installer and plugin startup also manage the visibility of an `orchestrator.md` agent template under the resolved config root (`$XDG_CONFIG_HOME/opencode/agents/` when `XDG_CONFIG_HOME` is set, otherwise `~/.config/opencode/agents/`).
