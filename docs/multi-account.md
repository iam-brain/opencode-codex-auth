# Multi-account

This plugin supports multiple OpenAI OAuth accounts and rotates between them when needed.

## Storage schema

Accounts are stored under `openai` in `~/.config/opencode/auth.json`.

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

Disabled accounts are always skipped.

## Tools

The plugin registers tools for account management:

- `codex-status`
- `codex-switch-accounts` (1-based index)
- `codex-toggle-account` (1-based index)
- `codex-remove-account` (requires `confirm: true`)
