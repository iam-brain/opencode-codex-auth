# Getting started

This plugin provides OpenAI Codex OAuth authentication for OpenCode, with multi-account rotation.

## Prerequisites

- Node.js 20+
- OpenCode installed

## Install (local development)

This repo is a TypeScript plugin. Build it and point OpenCode at the built `dist/` directory.

```bash
npm install
npm run build
```

Then reference the plugin from your OpenCode config:

```json
{
  "plugin": ["file:///absolute/path/to/opencode-openai-multi/dist"]
}
```

Keep plugin flags out of `opencode.json`. Put them in:

- `~/.config/opencode/codex-config.json`
- Example files:
  - `docs/examples/opencode.json`
  - `docs/examples/codex-config.json`

## Authenticate

Run OpenCode and use the OAuth login flow:

```bash
opencode auth login
```

In the interactive account manager:

- `Add new account` now returns to the menu after successful login so you can add multiple accounts in one run.
- `Esc` cleanly exits login.
- `Check quotas` fetches live usage and prints `5h`, `Weekly`, and `Credits`.

Auth data is split across:

- OpenCode OAuth marker: `~/.local/share/opencode/auth.json`
- Plugin multi-account store: `~/.config/opencode/codex-accounts.json`

If `codex-accounts.json` does not exist yet, the plugin can bootstrap from legacy files and from the OpenCode marker.

Once `codex-accounts.json` exists, it is authoritative. If you intentionally delete all accounts, the plugin will not auto-reseed from legacy files unless you explicitly transfer again.

The plugin store is written with atomic temp+rename and best-effort `0600`.

## Quick test

```bash
opencode run "say hi" --model=openai/gpt-5.2
```

If your account has server-side access, you can also try:

```bash
opencode run "say hi" --model=openai/gpt-5.3-codex
```
