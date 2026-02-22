# opencode-codex-auth

[![CI](https://github.com/iam-brain/opencode-codex-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/iam-brain/opencode-codex-auth/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40iam-brain%2Fopencode-codex-auth.svg)](https://www.npmjs.com/package/@iam-brain/opencode-codex-auth)

OpenCode plugin for OpenAI ChatGPT OAuth with multi-account management, Codex-compatible request modes, and dynamic model behavior controls.

Quick links: [Getting Started](docs/getting-started.md) · [Configuration](docs/configuration.md) · [Multi-account](docs/multi-account.md) · [Troubleshooting](docs/troubleshooting.md) · [Persona Tool](docs/persona-tool.md)

## Why this plugin

- Uses ChatGPT OAuth instead of API keys for OpenAI provider flows.
- Keeps account rotation state in a plugin-owned store (`codex-accounts.json`).
- Supports `native` and `codex` runtime modes.
- Adds account-manager UX to `opencode auth login` (quotas, toggles, scoped deletes, transfer).

## Quick start

Install and register the plugin (recommended):

```bash
npx -y @iam-brain/opencode-codex-auth@latest
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

By default, `npx -y @iam-brain/opencode-codex-auth@latest` runs the installer.

The installer does four things:

1. Ensures `@iam-brain/opencode-codex-auth@latest` is present in resolved `<config-root>/opencode.json` (`$XDG_CONFIG_HOME/opencode` when set, otherwise `~/.config/opencode`).
2. Creates `codex-config.json` with defaults at resolved config root (`$XDG_CONFIG_HOME/opencode` when set, otherwise `~/.config/opencode`) when missing.
3. Synchronizes `<config-root>/commands/create-personality.md` for `/create-personality` (created/updated as needed).
4. Synchronizes `<config-root>/skills/personality-builder/SKILL.md` (plus references) for skill-driven personality workflows.

At plugin startup, managed templates are synchronized to the latest version:

- `/create-personality` command template
- `personality-builder` skill bundle
- pinned Codex prompts cache (`codex-prompts-cache*.json`) is refreshed best-effort
- orchestrator agent visibility is reconciled based on effective collaboration profile

Re-run installer (idempotent):

```bash
npx -y @iam-brain/opencode-codex-auth@latest install
```

## Config split

Keep `opencode.json` minimal (plugin enablement only). Put runtime behavior in:

- resolved `<config-root>/codex-config.json`

Canonical config/env docs (complete key + variable reference) are in `docs/configuration.md`.

Schemas for user-edited JSON files are in:

- `schemas/codex-config.schema.json`
- `schemas/opencode.schema.json`
- `schemas/codex-accounts.schema.json` (advanced/manual recovery)

Personality files live in lowercase directories:

- project-local: `.opencode/personalities/`
- global: resolved `<config-root>/personalities/`

Create guided custom personalities with:

```bash
/create-personality
```

## Runtime modes

- `native`: native-plugin style identity/headers.
- `codex`: codex-rs style identity/headers.

## Account storage

- Primary runtime store: resolved `<config-root>/codex-accounts.json` (`$XDG_CONFIG_HOME/opencode` when set, otherwise `~/.config/opencode`)
- OpenCode provider auth marker (import source only): `${XDG_DATA_HOME:-~/.local/share}/opencode/auth.json`
- Session affinity cache: resolved `<config-root>/cache/codex-session-affinity.json`
- Quota snapshot cache: resolved `<config-root>/cache/codex-snapshots.json`

Legacy sources can be imported explicitly from the auth menu:

- resolved `<config-root>/openai-codex-accounts.json`
- `${XDG_DATA_HOME:-~/.local/share}/opencode/auth.json`

## Documentation

- [Docs portal](docs/README.md)
- [Getting started](docs/getting-started.md)
- [Configuration](docs/configuration.md)
- [Compaction](docs/compaction.md)
- [Multi-account](docs/multi-account.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Persona tool](docs/persona-tool.md)
- [Development docs](docs/development/README.md)
- [Upstream baseline/sync](docs/development/UPSTREAM_SYNC.md)

## Development

```bash
npm install
npm run verify
```

`npm run verify` includes ESM import specifier guards and a built CLI smoke check.
