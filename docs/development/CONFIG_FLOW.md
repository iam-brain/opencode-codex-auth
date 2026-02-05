# Config flow

Config is resolved with `resolveConfig({ env: process.env })`.

The implementation is intentionally conservative:

- Environment variables take precedence.
- Defaults are safe (debug off; proactive refresh off).
- Values are validated and normalized (booleans/numbers are parsed and clamped).

See `lib/config.ts`.
