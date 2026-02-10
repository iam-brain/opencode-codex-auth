# opencode-openai-multi

OpenCode plugin for OpenAI ChatGPT OAuth with production-focused multi-account management, Codex-compatible request modes, and dynamic model behavior controls.

## Why this plugin

- Uses ChatGPT OAuth instead of API keys for OpenAI provider flows.
- Keeps account rotation state in a plugin-owned store (`codex-accounts.json`).
- Supports `native`, `codex`, and experimental `collab` runtime modes.
- Adds account-manager UX to `opencode auth login` (quotas, toggles, scoped deletes, transfer).

## Quick start

Install and register the plugin:

```bash
npx -y @iam-brain/opencode-openai-multi
```

Then authenticate:

```bash
opencode auth login
```

Use an OpenAI model through OpenCode:

```bash
opencode run "say hi" --model=openai/gpt-5.2
```

## Install behavior

The installer (`install` command) does two things:

1. Ensures `@iam-brain/opencode-openai-multi@latest` is present in `~/.config/opencode/opencode.json`.
2. Installs Codex collaboration agent templates in `~/.config/opencode/agents/` as disabled files:
   - `Codex Orchestrator.md.disabled`
   - `Codex Default.md.disabled`
   - `Codex Plan.md.disabled`
   - `Codex Execute.md.disabled`
   - `Codex Review.md.disabled`
   - `Codex Compact.md.disabled`

At plugin startup, files are reconciled against runtime mode:

- `mode: "collab"` -> `.md.disabled` files are activated to `.md`
- `mode: "native"` or `mode: "codex"` -> Codex agents are disabled to `.md.disabled`

## Config split

Keep `opencode.json` minimal (plugin enablement only). Put runtime behavior in:

- `~/.config/opencode/codex-config.json`

Canonical config/env docs are in `docs/configuration.md`.

## Runtime modes

- `native`: native-plugin style identity/headers.
- `codex`: codex-rs style identity/headers.
- `collab`: Codex collaboration profile wiring (WIP / untested; not recommended for production).

## Account storage

- Provider auth marker: `~/.local/share/opencode/auth.json`
- Plugin multi-account store: `~/.config/opencode/codex-accounts.json`

Legacy sources can be imported explicitly from the auth menu:

- `~/.config/opencode/openai-codex-accounts.json`
- `~/.local/share/opencode/auth.json`

## Documentation

- Docs portal: `docs/README.md`
- Getting started: `docs/getting-started.md`
- Configuration: `docs/configuration.md`
- Multi-account: `docs/multi-account.md`
- Troubleshooting: `docs/troubleshooting.md`
- Development docs: `docs/development/`
