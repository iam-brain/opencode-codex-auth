# opencode-codex-auth

[![CI](https://github.com/iam-brain/opencode-codex-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/iam-brain/opencode-codex-auth/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40iam-brain%2Fopencode-codex-auth.svg)](https://www.npmjs.com/package/@iam-brain/opencode-codex-auth)

OpenCode plugin for OpenAI ChatGPT OAuth with multi-account management, Codex-compatible request modes, and dynamic model behavior controls.

Quick links: `docs/getting-started.md` · `docs/configuration.md` · `docs/multi-account.md` · `docs/troubleshooting.md`

## Why this plugin

- Uses ChatGPT OAuth instead of API keys for OpenAI provider flows.
- Keeps account rotation state in a plugin-owned store (`codex-accounts.json`).
- Supports `native` and `codex` runtime modes.
- Adds account-manager UX to `opencode auth login` (quotas, toggles, scoped deletes, transfer).

## Quick start

Install and register the plugin (recommended):

```bash
npx -y @iam-brain/opencode-codex-auth
```

Then authenticate:

```bash
opencode auth login
```

Use an OpenAI model through OpenCode:

```bash
opencode run "say hi" --model=openai/gpt-5
```

If that model is unavailable on your account, use any available `openai/*` model.

## Usage notice

This plugin is intended for personal development use with your own ChatGPT account. For production multi-user systems, use the OpenAI Platform API.

## Install behavior

By default, `npx -y @iam-brain/opencode-codex-auth` runs the installer.

The installer does two things:

1. Ensures `@iam-brain/opencode-codex-auth@latest` is present in `~/.config/opencode/opencode.json`.
2. Creates `~/.config/opencode/codex-config.json` with defaults when missing.
3. Synchronizes `~/.config/opencode/commands/create-personality.md` for `/create-personality` (created/updated as needed).
4. Synchronizes `~/.config/opencode/skills/personality-builder/SKILL.md` (plus references) for skill-driven personality workflows.

At plugin startup, managed templates are synchronized to the latest version:

- `/create-personality` command template
- `personality-builder` skill bundle

Re-run installer (idempotent):

```bash
npx -y @iam-brain/opencode-codex-auth install
```

## Config split

Keep `opencode.json` minimal (plugin enablement only). Put runtime behavior in:

- `~/.config/opencode/codex-config.json`

Canonical config/env docs (complete key + variable reference) are in `docs/configuration.md`.

Schemas for user-edited JSON files are in:

- `schemas/codex-config.schema.json`
- `schemas/opencode.schema.json`
- `schemas/codex-accounts.schema.json` (advanced/manual recovery)

Personality files live in lowercase directories:

- project-local: `.opencode/personalities/`
- global: `~/.config/opencode/personalities/`

Create guided custom personalities with:

```bash
/create-personality
```

## Runtime modes

- `native`: native-plugin style identity/headers.
- `codex`: codex-rs style identity/headers.

## Account storage

- Provider auth marker: `~/.local/share/opencode/auth.json`
- Plugin multi-account store: `~/.config/opencode/codex-accounts.json`
- Session affinity cache: `~/.config/opencode/cache/codex-session-affinity.json`
- Quota snapshot cache: `~/.config/opencode/cache/codex-snapshots.json`

Legacy sources can be imported explicitly from the auth menu:

- `~/.config/opencode/openai-codex-accounts.json`
- `~/.local/share/opencode/auth.json`

## Documentation

- Docs portal: `docs/README.md`
- Getting started: `docs/getting-started.md`
- Configuration: `docs/configuration.md`
- Compaction: `docs/compaction.md`
- Multi-account: `docs/multi-account.md`
- Troubleshooting: `docs/troubleshooting.md`
- Development docs: `docs/development/`
- Upstream baseline/sync: `docs/development/UPSTREAM_SYNC.md`

## Development

```bash
npm install
npm run verify
```
