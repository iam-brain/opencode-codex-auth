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

## Authenticate

Run OpenCode and use the OAuth login flow:

```bash
opencode auth login
```

The plugin stores credentials in `~/.config/opencode/auth.json` (best-effort `0600`).

## Quick test

```bash
opencode run "say hi" --model=openai/gpt-5.2
```
