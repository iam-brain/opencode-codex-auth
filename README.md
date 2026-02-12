# opencode-codex-auth

[![CI](https://github.com/iam-brain/opencode-codex-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/iam-brain/opencode-codex-auth/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40iam-brain%2Fopencode-codex-auth.svg)](https://www.npmjs.com/package/@iam-brain/opencode-codex-auth)

OpenCode plugin that authenticates OpenAI provider traffic with ChatGPT OAuth and routes requests through Codex backend endpoints.

Quick links: [Getting Started](docs/getting-started.md) · [Configuration](docs/configuration.md) · [Accounts and Rotation](docs/accounts-and-rotation.md) · [Troubleshooting](docs/troubleshooting.md)

## Quick start

Install and register the plugin:

```bash
npx -y @iam-brain/opencode-codex-auth
```

Authenticate:

```bash
opencode auth login
```

Run one request:

```bash
opencode run "say hi" --model=openai/gpt-5.3-codex
```

If `openai/gpt-5.3-codex` is not available on your account, use another available `openai/*` model.

## What the installer changes

`npx -y @iam-brain/opencode-codex-auth` runs `install` by default (`bin/opencode-codex-auth.ts`, `lib/installer-cli.ts`).

Installer actions:

1. Ensures `@iam-brain/opencode-codex-auth@latest` exists in `~/.config/opencode/opencode.json` (`lib/opencode-install.ts`).
2. Creates `~/.config/opencode/codex-config.json` if missing (`lib/config.ts`).
3. Synchronizes `/create-personality` command template (`lib/personality-command.ts`).
4. Synchronizes `personality-builder` skill files (`lib/personality-skill.ts`).

Re-run installer safely:

```bash
npx -y @iam-brain/opencode-codex-auth install
```

## Runtime modes

- `native` (default): native OpenCode-style identity/header path.
- `codex`: codex-style identity/header path.

Mode behavior source of truth: `lib/config.ts` and `lib/codex-native.ts`.

## Storage files

- Plugin account store: `~/.config/opencode/codex-accounts.json` (`lib/storage.ts`).
- Plugin config: `~/.config/opencode/codex-config.json` (`lib/config.ts`).
- Session affinity cache: `~/.config/opencode/cache/codex-session-affinity.json` (`lib/session-affinity.ts`).
- Quota snapshot cache: `~/.config/opencode/cache/codex-snapshots.json` (`lib/codex-status-storage.ts`).
- OpenCode provider marker: `~/.local/share/opencode/auth.json` (read for transfer checks in `lib/storage.ts`).

## Documentation

- Docs index: `docs/README.md`
- User docs: `docs/getting-started.md`, `docs/configuration.md`, `docs/accounts-and-rotation.md`, `docs/troubleshooting.md`, `docs/privacy-and-data-handling.md`
- Maintainer docs: `docs/maintainers/releasing.md`, `docs/maintainers/documentation-standards.md`
- Development internals: `docs/development/`

## Development

```bash
npm install
npm run verify
```

## Usage notice

This plugin is intended for personal development use with your own ChatGPT account. For production multi-user systems, use the OpenAI Platform API.
