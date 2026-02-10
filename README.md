# opencode-openai-multi

A fork of the Native OpenAI Codex OAuth auth for OpenCode, upgraded with a dedicated Codex spoof mode, multi-account rotation, and account-management UX.

Docs portal: `docs/README.md`

## What this plugin does

- Uses ChatGPT OAuth and routes OpenCode OpenAI traffic to Codex backend responses.
- Maintains a plugin-owned multi-account store in `~/.config/opencode/codex-accounts.json`.
- Rotates/fails over across enabled accounts with cooldown and refresh handling.
- Provides account tools and a CLI account manager (`opencode auth login`) with:
  - Add account (browser/headless)
  - Check quotas (live fetch: 5h + Weekly + Credits)
  - Enable/disable
  - Refresh token
  - Delete account / delete all accounts

## Install (published package)

```bash
npx -y @iam-brain/opencode-openai-multi
```

Default installer behavior:

- Ensures plugin enablement in `~/.config/opencode/opencode.json` with `@iam-brain/opencode-openai-multi@latest`.
- Installs codex-style collaboration agents in `~/.config/opencode/agents/` as disabled files:
  - `Codex Orchestrator.md.disabled`
  - `Codex Default.md.disabled`
  - `Codex Plan.md.disabled`
  - `Codex Execute.md.disabled`
  - `Codex Review.md.disabled`
  - `Codex Compact.md.disabled`
- Codex collaboration profile behavior is only enabled when:
  - runtime mode is explicitly set to `collab` in `codex-config.json`, and
  - the active agent is in the `Codex*` family.
- Agent activation is reconciled on plugin startup:
  - `mode: "collab"` keeps `Codex *.md` active
  - other modes auto-disable to `Codex *.md.disabled`
- `collab` mode is currently WIP/untested and not recommended for production use yet.

See:

- `docs/getting-started.md`
- `docs/configuration.md`
- `docs/examples/`

## Authenticate

```bash
opencode auth login
```

Browser login notes:

- `Add new account` returns to the account menu so you can add multiple accounts in one session.
- `Esc` exits cleanly (does not fall through to code-paste mode).
- `Check quotas` fetches live quota data and prints:
  - `5h` bar with inline reset time
  - `Weekly` bar with inline reset time
  - `Credits`
- Session compaction prompt is automatically swapped to codex-rs compact instructions for OpenAI-provider sessions.
- `/review` subtasks are automatically hot-swapped to the `Codex Review` agent for OpenAI-provider sessions.
