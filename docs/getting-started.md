# Getting started

This guide covers install, login, migration transfer, and first verification.

## Prerequisites

- Node.js 20+
- OpenCode installed and working

## 1) Install the plugin

Published install:

```bash
npx -y @iam-brain/opencode-openai-multi
```

What this does:

- Adds `@iam-brain/opencode-openai-multi@latest` to `~/.config/opencode/opencode.json`
- Installs Codex collab agents to `~/.config/opencode/agents/` as `*.md.disabled`

## 2) Keep OpenCode config minimal

`opencode.json` should contain plugin enablement only.

Example:

```json
{
  "plugin": ["@iam-brain/opencode-openai-multi@latest"]
}
```

Put all plugin behavior flags in:

- `~/.config/opencode/codex-config.json`

Use `docs/examples/codex-config.json` as a baseline.

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
opencode run "say hi" --model=openai/gpt-5.2
```

If your account has access:

```bash
opencode run "say hi" --model=openai/gpt-5.3-codex
```

## Mode + agent behavior

Runtime mode is configured in `codex-config.json`.

- `native`: default
- `codex`
- `collab` (WIP / untested)

Agent files are reconciled at plugin startup:

- `collab`: Codex agents are enabled (`.md`)
- non-collab: Codex agents are disabled (`.md.disabled`)

## Local development install

```bash
npm install
npm run build
```

Then use a file plugin path in your local `opencode.json`:

```json
{
  "plugin": ["file:///absolute/path/to/opencode-openai-multi/dist"]
}
```
