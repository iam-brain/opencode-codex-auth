# Getting started

This guide covers install, login, migration transfer, and first verification.

## Prerequisites

- Node.js 20+
- OpenCode installed and working

## 1) Install the plugin

Published install:

```bash
npx -y @iam-brain/opencode-codex-auth
```

What this does:

- Adds `@iam-brain/opencode-codex-auth@latest` to `~/.config/opencode/opencode.json`
- Creates `~/.config/opencode/codex-config.json` if missing
- Synchronizes `/create-personality` command at `~/.config/opencode/commands/create-personality.md`
- Synchronizes `personality-builder` skill at `~/.config/opencode/skills/personality-builder/SKILL.md`

Re-run installer (idempotent):

```bash
npx -y @iam-brain/opencode-codex-auth install
```

## 2) Keep OpenCode config minimal

`opencode.json` should contain plugin enablement only.

Example:

```json
{
  "plugin": ["@iam-brain/opencode-codex-auth@latest"]
}
```

Put all plugin behavior flags in:

- `~/.config/opencode/codex-config.json`

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
- Enable/disable accounts
- Refresh tokens
- Scoped delete and delete-all actions

## 4) Optional migration transfer

Legacy import is explicit, not automatic.

If `codex-accounts.json` is missing and legacy sources exist, the auth menu offers:

- `Transfer OpenAI accounts from native & old plugins?`

Import sources:

- `~/.config/opencode/openai-codex-accounts.json`
- `~/.local/share/opencode/auth.json`

## 5) Verify with a real run

```bash
opencode run "say hi" --model=openai/gpt-5
```

If that model is not available on your account, pick any available `openai/*` model.

## 6) Create a custom personality (optional)

Run:

```bash
/create-personality
```

This guided flow writes a profile into:

- `.opencode/personalities/<key>.md` (project scope), or
- `~/.config/opencode/personalities/<key>.md` (global scope)

## Mode + agent behavior

Runtime mode is configured in `codex-config.json`.

- `native`: default
- `codex`

Managed templates are synchronized at plugin startup:

- `/create-personality` command is refreshed to the managed latest template
- `personality-builder` skill bundle is refreshed to the managed latest template

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
