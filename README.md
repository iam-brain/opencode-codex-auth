# opencode-codex-auth

[![CI](https://github.com/iam-brain/opencode-codex-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/iam-brain/opencode-codex-auth/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40iam-brain%2Fopencode-codex-auth.svg)](https://www.npmjs.com/package/@iam-brain/opencode-codex-auth)

OpenCode plugin for ChatGPT OAuth auth with multi-account management and Codex-compatible request behavior.

## Highlights

- ChatGPT OAuth flow for OpenCode OpenAI provider usage.
- Multi-account storage, rotation, and account health controls.
- Runtime modes for native-compatible or codex-style request identity.
- Integrated auth UX via `opencode auth login` (switch, refresh, disable, remove, transfer).

## Requirements

- Node.js `22.x`
- npm `10.9.2` (via `packageManager` / Corepack)
- OpenCode CLI available on your PATH

## Install

```bash
npx -y @iam-brain/opencode-codex-auth@latest
```

Authenticate:

```bash
opencode auth login
```

Run with an OpenAI model:

```bash
opencode run "say hi" --model=openai/gpt-5
```

## Configuration

Keep plugin install/enablement in `opencode.json`, and runtime behavior in `codex-config.jsonc`. The plugin still accepts commented legacy `codex-config.json` files for compatibility.

- Config reference: [docs/configuration.md](docs/configuration.md)
- Multi-account behavior: [docs/multi-account.md](docs/multi-account.md)
- Troubleshooting: [docs/troubleshooting.md](docs/troubleshooting.md)

## Documentation

- Docs index: [docs/README.md](docs/README.md)
- Getting started: [docs/getting-started.md](docs/getting-started.md)
- Persona tooling: [docs/persona-tool.md](docs/persona-tool.md)
- Releasing: [docs/releasing.md](docs/releasing.md)
- Development docs: [docs/development/README.md](docs/development/README.md)

## Development

```bash
npm install
npm run hooks:install
npm run verify
```

Helpful local commands:

```bash
npm run prepush
npm run lint
npm run test:coverage
npm run check:docs
```

`npm run prepush` is the lightweight local gate for PR updates and pushes. It runs formatting, main TypeScript checks, test-project TypeScript checks, and the full Vitest suite. `npm run verify` is the primary quality gate and adds anti-mock, coverage/ratchet, docs drift, build validation, and CLI smoke checks.

## Usage Note

This plugin is intended for personal development usage with your own ChatGPT account. For production multi-user systems, use official OpenAI Platform API auth flows.
