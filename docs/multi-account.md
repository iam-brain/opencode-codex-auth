# Multi-account

This plugin supports multiple OpenAI OAuth accounts and rotates between them when needed.

## Storage schema

Accounts are stored under `openai` in the plugin store:

- `~/.config/opencode/codex-accounts.json`

OpenCode also keeps provider OAuth state in:

- `~/.local/share/opencode/auth.json`

Key fields:

- `accounts[]`: list of account records
- `activeIdentityKey`: the active pointer
- `enabled`: disabled accounts are never selected, refreshed, rotated, or mutated

## Identity keys

`identityKey` is derived ONLY from:

- `accountId.trim()`
- `email.trim().toLowerCase()`
- `plan.trim().toLowerCase()`

Format: `accountId|email|plan`

## Rotation

Selection strategy is stored in `openai.strategy`:

- `sticky`
- `round_robin`
- `hybrid`

Default strategy is `sticky` when unset.

Sticky behavior details:

- Requests stay on one account while it remains healthy.
- New sessions (`prompt_cache_key`) are distributed to the next healthy account (session affinity), so subagent sessions can spread load without enabling full `round_robin`/`hybrid`.
- If no active/session assignment exists, sticky can still distribute by PID offset across processes.

Disabled accounts are always skipped.

Automatic failover happens in two cases:

- Rate-limit driven (`429` + cooldown)
- Auth-refresh driven during token acquisition
  - `invalid_grant`: failing account is disabled and the request continues with another enabled account when available
  - transient refresh failures / missing refresh token: failing account is cooled down and the request continues with another enabled account when available

The request only hard-fails when all enabled candidates are exhausted.

## Tools

The plugin registers tools for account management:

- `codex-status`
- `codex-switch-accounts` (1-based index)
- `codex-toggle-account` (1-based index)
- `codex-remove-account` (requires `confirm: true`)

## Interactive account manager (`opencode auth login`)

The login flow includes a full account-management menu.

Primary actions:

- Add new account
- Check quotas
- Manage accounts (enable/disable)
- Configure models in `codex-config.json`
- Delete all accounts

Per-account actions:

- Enable/disable
- Refresh token
- Delete this account
- Delete all accounts

Behavior notes:

- `Add new account` returns to the menu after success so you can continue adding accounts.
- `Check quotas` performs a live backend fetch and renders:
  - `5h` usage bar with inline reset timer
  - `Weekly` usage bar with inline reset timer
  - `Credits`
- `Delete all accounts` persists as empty `accounts: []`; this no longer triggers immediate legacy auto-reimport.
- `Transfer OpenAI accounts from native & old plugins?` is shown only when `codex-accounts.json` is missing and a legacy/native source exists.
