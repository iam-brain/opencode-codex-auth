# Compaction behavior

This plugin can override OpenCode's stock compaction flow for OpenAI sessions.

## When it applies

- `runtime.mode` must be `"codex"`.
- The active session model provider must be `openai`.

If either condition is not met, OpenCode keeps its native compaction behavior unchanged.

## What changes in codex mode

For matching OpenAI sessions, the plugin applies codex-rs compact template behavior:

- Replaces the compaction prompt with the codex compact prompt template.
- Prefixes compaction summary text with the codex `summary_prefix` handoff context.

Implementation reference: `lib/codex-native.ts` hooks `experimental.session.compacting` and `experimental.text.complete`.
