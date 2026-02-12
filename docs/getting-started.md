# Getting Started

This guide covers install, login, optional account transfer, and first request verification.

## Prerequisites

- Node.js 20+
- OpenCode installed and working

## 1) Install the plugin

```bash
npx -y @iam-brain/opencode-codex-auth
```

Installer behavior (`lib/installer-cli.ts`, `lib/opencode-install.ts`, `lib/config.ts`):

- Adds `@iam-brain/opencode-codex-auth@latest` to `~/.config/opencode/opencode.json`.
- Creates `~/.config/opencode/codex-config.json` if missing.
- Synchronizes `/create-personality` command template and `personality-builder` skill files.

Re-run installer (idempotent):

```bash
npx -y @iam-brain/opencode-codex-auth install
```

## 2) Keep `opencode.json` minimal

Use only plugin registration in `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["@iam-brain/opencode-codex-auth@latest"]
}
```

Put plugin runtime behavior in `~/.config/opencode/codex-config.json`.

Use examples:

- `docs/examples/opencode.json`
- `docs/examples/codex-config.json`

## 3) Authenticate

```bash
opencode auth login
```

Account manager supports:

- adding multiple accounts in one session
- quota checks (`5h`, `Weekly`, `Credits`)
- enable/disable
- token refresh
- scoped delete and delete-all

Auth menu behavior source: `lib/codex-native.ts`, `lib/ui/auth-menu-runner.ts`.

## 4) Optional transfer from legacy/native stores

Legacy transfer is explicit and only offered when `codex-accounts.json` is missing (`lib/storage.ts`).

Import candidates:

- `~/.config/opencode/openai-codex-accounts.json`
- `~/.local/share/opencode/auth.json`

Coverage: `test/storage.test.ts`.

## 5) Verify with a real request

```bash
opencode run "say hi" --model=openai/gpt-5
```

If that model is unavailable, use another available `openai/*` model.

## 6) Optional custom personality

Run:

```bash
/create-personality
```

This writes to:

- `.opencode/personalities/<key>.md` (project scope)
- `~/.config/opencode/personalities/<key>.md` (global scope)

Implementation source: `lib/personality-command.ts`, `lib/personality-skill.ts`, `index.ts`.
