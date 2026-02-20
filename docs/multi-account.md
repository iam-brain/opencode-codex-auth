# Multi-account behavior

This plugin supports multi-account OpenAI OAuth with strict identity, health-aware routing, and explicit legacy transfer.

## Storage model

Primary file:

- resolved `<config-root>/codex-accounts.json`
  - `$XDG_CONFIG_HOME/opencode/codex-accounts.json` when `XDG_CONFIG_HOME` is set
  - otherwise `~/.config/opencode/codex-accounts.json`

Provider marker file:

- `~/.local/share/opencode/auth.json`

OpenAI auth is stored with domain-aware account sets:

- `openai.native`
- `openai.codex`
- compatibility aggregate: `openai.accounts`

Each account can include `authTypes` so one identity can be valid in one or both auth modes.

### Auth file shape

`codex-accounts.json` stores both mode-specific domains and a compatibility aggregate:

```json
{
  "openai": {
    "type": "oauth",
    "accounts": [
      {
        "identityKey": "acc|user@example.com|plus",
        "authTypes": ["native", "codex"]
      }
    ],
    "native": {
      "accounts": []
    },
    "codex": {
      "accounts": []
    }
  }
}
```

Routing, refresh, and active-account selection use the mode-specific domain (`openai.native` or `openai.codex`) for the current runtime mode.

## Identity key policy

Identity key is strict and deterministic:

- `accountId|email|plan`

Normalization:

- `email` lowercased/trimmed
- `plan` lowercased/trimmed
- `accountId` trimmed

Matching preference:

1. strict `identityKey`
2. refresh token fallback only if identity is unavailable

## Rotation strategies

Configured in `runtime.rotationStrategy`:

- `sticky` (default)
- `hybrid`
- `round_robin`

### sticky

- Reuses active account while healthy.
- With PID/session offset enabled, each new session is assigned a different healthy account via cursor rotation; once assigned, the session stays on that account.

### hybrid

- Reuses active account when valid.
- Otherwise selects the least-recently-used (LRU) healthy account based on `lastUsed` timestamps.
- With PID/session offset enabled, session assignments are sticky and health-aware.

### round_robin

- Advances account per request among healthy candidates.
- Highest churn; generally least efficient for token/refresh usage.

## Health and failover

Accounts are eligible only when:

- `enabled !== false`
- no active cooldown (`cooldownUntil <= now`)

Failover triggers:

- `429` + retry parsing -> cooldown + retry on another healthy account
- refresh/auth failures:
  - `invalid_grant` -> account disabled
  - transient token failure -> cooldown

Request hard-fails only when all enabled candidates are exhausted.

## Interactive account manager

Open with:

```bash
opencode auth login
```

Primary actions:

- Add new account
- Check quotas
- Manage accounts (enable/disable)
- Configure models in `codex-config.json`
- Delete all accounts

Per-account actions:

- Enable/disable
- Refresh token
- Delete account
- Delete all accounts (scoped)

## Tooling hooks

Registered tools:

- `codex-status`
- `codex-switch-accounts`
- `codex-toggle-account`
- `codex-remove-account`

All index arguments are 1-based.

## Legacy transfer

Legacy import is explicit-only through auth menu transfer.

Source files:

- `~/.config/opencode/openai-codex-accounts.json`
- `~/.local/share/opencode/auth.json`

If `codex-accounts.json` exists (including empty accounts), it remains authoritative.
