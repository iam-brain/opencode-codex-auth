# opencode-codex-auth docs

`opencode-codex-auth` brings ChatGPT OAuth-backed OpenAI access to OpenCode with hardened multi-account behavior.

## What you get

- OpenAI OAuth account login/management in `opencode auth login`
- Multi-account rotation with health-aware failover
- Runtime identity modes (`native`, `codex`) and experimental collaboration mode (`collab`)
- Dynamic model behavior overrides (`global`, `perModel`, `variants`)

## Read in this order

1. `getting-started.md`
2. `configuration.md`
3. `multi-account.md`
4. `troubleshooting.md`

For internals and contribution workflows, continue with `development/ARCHITECTURE.md` and `development/TESTING.md`.
