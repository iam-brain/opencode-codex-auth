# Getting started

This guide covers install, login, migration transfer, and first verification.

## Prerequisites

- Node.js 20+
- OpenCode installed and working

## 1) Install the plugin

Published install:

```bash
npx -y @iam-brain/opencode-codex-auth@latest
```

What this does:

- Adds `@iam-brain/opencode-codex-auth@latest` to resolved `<config-root>/opencode.json` (`$XDG_CONFIG_HOME/opencode` when set, otherwise `~/.config/opencode`)
- Creates `codex-config.json` at resolved config root (`$XDG_CONFIG_HOME/opencode` when set, otherwise `~/.config/opencode`) if missing
- Synchronizes `/create-personality` command at `<config-root>/commands/create-personality.md`
- Synchronizes `personality-builder` skill at `<config-root>/skills/personality-builder/SKILL.md`

Re-run installer (idempotent):

```bash
npx -y @iam-brain/opencode-codex-auth@latest install
```

Installer flags:

- `--config <path>`: use a custom `opencode.json` path.
- `--plugin <specifier>`: override plugin specifier written into `opencode.json`.

`codex-config.json` is still created at the default resolved config location. To load config from a custom path at runtime, set `OPENCODE_OPENAI_MULTI_CONFIG_PATH`.

## 2) Keep OpenCode config minimal

`opencode.json` should contain plugin enablement only.

Example:

```json
{
  "plugin": ["@iam-brain/opencode-codex-auth@latest"]
}
```

Put all plugin behavior flags in:

- resolved `<config-root>/codex-config.json` (`$XDG_CONFIG_HOME/opencode` when set, otherwise `~/.config/opencode`)

Use `docs/examples/codex-config.json` as a baseline.
Use schemas for autocomplete/validation:

- `schemas/codex-config.schema.json`
- `schemas/opencode.schema.json`
- `schemas/codex-accounts.schema.json`

## 3) Authenticate

```bash
opencode auth login
```

Account manager highlights:

- Add multiple accounts in one run (`Add new account` returns to menu)
- Check live quotas (`5h`, `Weekly`, `Credits`)
- Receive quota warning toasts at low-remaining thresholds (`25%`, `20%`, `10%`, `5%`, `2.5%`, `0%`)
- Auto-switch accounts when `5h` or `weekly` quota is exhausted
- Enable/disable accounts
- Refresh tokens
- Scoped delete and delete-all actions

## 4) Optional migration transfer

Legacy import is explicit, not automatic.

If `codex-accounts.json` is missing and legacy sources exist, the auth menu offers:

- `Transfer OpenAI accounts from native & old plugins?`

Import sources:

- resolved `<config-root>/openai-codex-accounts.json`
- `${XDG_DATA_HOME:-~/.local/share}/opencode/auth.json`

## 5) Verify with a real run

```bash
opencode run "say hi" --model=openai/gpt-5.4
```

If that model is not available on your account, pick any available `openai/*` model.
The plugin now tracks the live Codex catalog, so exact GPT-5-family availability still depends on your account's current entitlements.

## 5a) Optional: enable GPT-5.4 fast mode

Add a `serviceTier` override in `codex-config.json`:

```json
{
  "global": {
    "serviceTier": "priority"
  }
}
```

This maps to request-body `service_tier: "priority"` for `gpt-5.4*` only.
If your host/request already sets `service_tier`, the plugin leaves it alone.

## 5b) Optional: try GPT-5.4 1M context

GPT-5.4 in Codex exposes experimental long-context support via request-level `model_context_window` and `model_auto_compact_token_limit`.
Those are not plugin config keys; they come from your OpenCode/request configuration, and the plugin preserves them unchanged when rewriting request bodies.

Notes:

- The live Codex catalog still advertises a standard `272000` context window for `gpt-5.4`.
- Larger `model_context_window` values are explicit request overrides.
- Requests above the standard 272K window count at 2x normal usage.

## 6) Create a custom personality (optional)

Run:

```bash
/create-personality
```

This guided flow writes a profile into:

- `.opencode/personalities/<key>.md` (project scope), or
- `<config-root>/personalities/<key>.md` (global scope)

## Mode + agent behavior

Runtime mode is configured in `codex-config.json`.

- `native`: default
- `codex`

Prompt cache key strategy is also configurable under `runtime.promptCacheKeyStrategy`:

- `default`: keeps upstream session-based keying
- `project`: uses a project-path + mode hash

Managed templates are synchronized at plugin startup:

- `/create-personality` command is refreshed to the managed latest template
- `personality-builder` skill bundle is refreshed to the managed latest template
- pinned Codex prompts cache is refreshed best-effort (`codex-prompts-cache*.json`)
- orchestrator agent visibility is reconciled based on effective collaboration profile

## Local development install

```bash
npm install
npm run build
```

Then use a file plugin path in your local `opencode.json`:

```json
{
  "plugin": ["file:///absolute/path/to/opencode-codex-auth/dist"]
}
```
