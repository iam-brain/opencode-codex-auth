# Persona Tool

`persona-tool` generates a Codex-style agent/persona markdown spec (plus optional JSON metadata) from a source "voice" markdown file.

## Quick start

Show help:

```bash
npx -y -p @iam-brain/opencode-codex-auth persona-tool --help
```

Generate a markdown agent file:

```bash
npx -y -p @iam-brain/opencode-codex-auth persona-tool \
  --in voice.md \
  --style friendly-sized \
  --domain coding \
  --out agent.md
```

Write JSON metadata (includes `voice_signature`, `protocol_rules`, and optional `variants`):

```bash
npx -y -p @iam-brain/opencode-codex-auth persona-tool \
  --in voice.md \
  --style mid \
  --domain general \
  --json persona.json
```

## Options

- `--in <path>`: required input markdown file.
- `--style <lean|mid|friendly-sized>`: output size/detail target.
- `--domain <coding|audit|research|general>`: domain add-ons.
- `--voice-fidelity <0..1>`: how strongly to mirror source voice.
- `--competence-strictness <0..1>`: how strongly to enforce protocol rules.
- `--out <path>`: write markdown to file (stdout when omitted).
- `--json <path>`: write JSON output to file.
- `--no-variants`: omit `lean|mid|friendly-sized` variants from JSON.
