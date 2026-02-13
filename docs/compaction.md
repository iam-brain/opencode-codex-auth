# Compaction behavior

This plugin can override OpenCode's stock compaction flow for OpenAI sessions.

## When it applies

- `runtime.codexCompactionOverride` must be enabled.
- The active session model provider must be `openai`.

Default behavior:

- `runtime.mode: "codex"` => compaction override is on by default.
- `runtime.mode: "native"` => compaction override is off by default.

You can explicitly override either default with `runtime.codexCompactionOverride`.

If override is disabled or provider is not `openai`, OpenCode keeps native compaction behavior unchanged.

You can also enable/disable this via env override:

- `OPENCODE_OPENAI_MULTI_CODEX_COMPACTION_OVERRIDE=1|0|true|false`

## What changes in codex mode

For matching OpenAI sessions, the plugin applies codex-rs compact template behavior:

- Replaces the compaction prompt with the codex compact prompt template.
- Prefixes compaction summary text with the codex `summary_prefix` handoff context.

Implementation reference: hook logic lives in `lib/codex-native/chat-hooks.ts` and is wired by `lib/codex-native.ts`.
