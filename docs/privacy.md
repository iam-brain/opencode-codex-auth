# Privacy and data handling

## Files written by the plugin

- Resolved OpenCode config root paths:
  - `$XDG_CONFIG_HOME/opencode/...` when `XDG_CONFIG_HOME` is set
  - otherwise `~/.config/opencode/...`
- `<config-root>/codex-accounts.json`
  - plugin-owned OpenAI account rotation/auth state
- `<config-root>/.gitignore`
  - best-effort safety entries for plugin credential/cache/log artifacts
  - managed entries:
    - `.gitignore`
    - `codex-accounts.json`
    - `codex-accounts.json.tmp.*`
    - `codex-accounts.json.*.tmp`
    - `quarantine/`
    - `cache/codex-session-affinity.json`
    - `cache/codex-snapshots.json`
    - `logs/codex-plugin/`
- `<config-root>/cache/codex-session-affinity.json`
  - sticky/hybrid session-to-account affinity state
- `<config-root>/cache/codex-snapshots.json`
  - quota snapshot cache used by status/quota views
- `<config-root>/cache/codex-client-version.json`
  - cached Codex client target version (`version`, `fetchedAt`)
- `<config-root>/cache/codex-models-cache-meta.json`
  - shared GitHub model catalog metadata (`etag`, `tag`, `lastChecked`, `url`)
- `<config-root>/cache/codex-models-cache.json`
  - shared GitHub model catalog snapshot
- `<config-root>/cache/codex-models-cache-<hash>.json`
  - account-scoped server model catalog mirror
- `<config-root>/cache/codex-auth-models-<hash>.json`
  - plugin-primary account-scoped model catalog cache
- `<config-root>/cache/codex-prompts-cache.json`
  - pinned upstream orchestrator/plan prompt cache
- `<config-root>/cache/codex-prompts-cache-meta.json`
  - pinned prompt cache metadata (`lastChecked`, URLs, ETags)
- `<config-root>/logs/codex-plugin/` (optional)
  - request/response snapshot logs when enabled
- `<config-root>/logs/codex-plugin/shareable-debug.jsonl` (optional)
  - bounded privacy-first structured debug summary log with per-process pseudonyms for account/session correlation
- `<config-root>/logs/codex-plugin/shareable-debug-state/segments/` (optional)
  - rolling crash-tolerant pseudonymized event buffer used for pre-incident context
- `<config-root>/logs/codex-plugin/shareable-debug-state/incidents/` (optional)
  - dedicated pseudonymized before/after incident captures around error triggers
- `<config-root>/logs/codex-plugin/shareable-debug-state/incident-state.json` (optional)
  - recovery manifest for interrupted incident capture
- `<config-root>/logs/codex-plugin/oauth-lifecycle.log` (optional)
  - OAuth lifecycle debug log when `CODEX_AUTH_DEBUG` is enabled

## External files read/imported (not plugin-owned)

- resolved `<config-root>/openai-codex-accounts.json`
  - Legacy plugin account file read only during explicit transfer/import flows
- `${XDG_DATA_HOME:-~/.local/share}/opencode/auth.json`
  - OpenCode provider auth marker/state legacy transfer source

Recommended additional local ignore patterns (not auto-managed by plugin):

- `cache/codex-client-version.json`
- `cache/codex-models-cache*.json`
- `cache/codex-auth-models-*.json`
- `cache/codex-prompts-cache*.json`
- `logs/codex-plugin/oauth-lifecycle.log*`

## Related compatibility caches

- Existing Codex instruction cache files under `<config-root>/cache/` (for example `codex-instructions.md`, `codex-instructions-meta.json`, `gpt-5.1-instructions.md`) may coexist and are preserved.
- Metadata conventions are aligned (`etag`, `tag`, `lastChecked`, `url`) for GitHub-backed cache files.

## Sensitive data handling

- Auth files contain OAuth material and should be treated like credentials.
- Writes use atomic temp+rename and best-effort `0600` permissions.
- Corrupt auth files are quarantined by default with bounded retention under `<auth-dir>/quarantine/`.

## Logging behavior

- Debug logging is opt-in.
- Snapshot logging is opt-in.
- Snapshot writer redacts sensitive auth headers/tokens before persistence.
- Snapshot writer also redacts sensitive account/session metadata keys and sensitive URL query values.
- Live-headers snapshots redact `prompt_cache_key` values.
- Shareable debug mode never writes raw tokens, cookies, OAuth secrets, raw emails/account IDs/identity keys/session IDs, raw `prompt_cache_key` values, or raw request bodies.
- Shareable debug pseudonyms are stable only within a single process/log bundle.
- Shareable debug incident capture keeps a rolling on-disk pseudonymized buffer so before-error context can survive process exit or crash.
- If request body capture is enabled, prompt/tool payload content may still be written; use short-lived debugging windows only.
- OAuth debug lifecycle logs rotate at a configurable size cap.

## Legacy import

Legacy import is explicit via auth menu transfer and does not run implicitly during normal storage loads.
