# Documentation Structure

This document explains the organization of documentation in this repository.

## Structure overview

```
├── README.md
├── AGENTS.md
├── docs/
│   ├── index.md
│   ├── README.md
│   ├── DOCUMENTATION.md
│   ├── _config.yml
│   ├── getting-started.md
│   ├── configuration.md
│   ├── multi-account.md
│   ├── troubleshooting.md
│   ├── privacy.md
│   ├── releasing.md
│   └── development/
│       ├── ARCHITECTURE.md
│       ├── CONFIG_FLOW.md
│       ├── CONFIG_FIELDS.md
│       └── TESTING.md
└── docs/plans/  (nested git repo; ignored by parent)
```

## Notes

- `docs/plans/` is intentionally ignored by the main repository and is expected to be managed as its own nested git repository.
- Avoid putting secrets in docs, plans, or examples. Treat any `auth.json` content as sensitive.
