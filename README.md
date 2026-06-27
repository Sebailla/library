# biblioteca-v2

Monorepo for the next iteration of the `alejandria` personal-library
project. Lives alongside the legacy MVP at
`../biblioteca/` and replaces it incrementally — the MVP stays
read-only as the reference implementation.

## Layout

```
biblioteca-v2/
├── services/
│   ├── extractors-py/   PR1 — Python sidecar CLI (this commit)
│   └── nas-backend/     PR2 — NestJS + Postgres + Redis + workers
├── apps/
│   ├── web/             PR3 — Next.js 16 + React 19 App Router
│   └── mac/             PR4 — Electron shell wrapping apps/web
└── packages/
    └── core/types/      Shared TS types mirroring alejandria/core/models.py
```

## PR1 — Python sidecar

The `services/extractors-py/` package is the first deliverable. It is
independently testable today (no other infra needed) and is what PR2's
BullMQ workers will spawn to extract metadata from scanned files.

See:

- [Design rationale](openspec/changes/alejandria-v2/design.md)
- [Spec](openspec/changes/alejandria-v2/specs/python-sidecar-cli/spec.md)
- [Task list](openspec/changes/alejandria-v2/tasks.md)

## Status

- **PR1 (current)**: scaffolding only — `extract`, `ocr`, `scan`
  subcommands return a `NOT_IMPLEMENTED` error envelope. Tests pass on
  Python 3.12 and 3.13.
- PR2 → PR4 are scoped but not yet started.