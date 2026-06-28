# Changelog

All notable changes to **alejandria-v2** are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned
- PR3: Next.js 16 app shell (browse + search + reader)
- PR4: Electron shell + iCloud Drive sync + 7-layer ISBN pipeline

---

## [0.2.0] — 2026-06-28 — NestJS backend with 4R review fixes

Second release of the `alejandria-v2` refactor. Adds the complete NestJS backend that lives on the QNAP NAS, plus all fixes from the 4R review fan-out (R1 Risk, R2 Readability, R3 Reliability, R4 Resilience).

### Added

- NestJS 10 backend scaffold with health endpoint
- Postgres 16 + pgroonga schema covering books, authors, bilingual categories (es + en), book_categories, sagas, downloads, devices
- 10 idempotent SQL migrations with `schema_migrations` bookkeeping
- Auth module: PIN pairing + JWT issuance + SHA-256 token hashing
- Books/Authors/Search HTTP modules with pgroonga-backed full-text search
- Downloads HTTP module with per-device ownership checks
- Workers: BullMQ + Redis + sidecar Python spawn with path sanitization, 64 MB stdout cap, 60 s timeout, attempts cap, exponential backoff
- Discovery: mDNS (with bonjour error listener) + Tailscale IP probe + split endpoint (pre-auth `/api/discovery/info`, auth-required `/api/discovery/network`)
- `@nestjs/throttler` rate limiting on auth and discovery endpoints
- Global `ValidationPipe` returning the project's standard `{error: {code, message}}` envelope
- pg_cron nightly `pgroonga_index_defrag` migration (with Dockerfile.pg overlay for operators on the QNAP)
- 165 tests passing across unit and e2e layers

### Security

- **BREAKING (production)**: hardcoded JWT secret and PIN defaults removed; production fails to start if `NAS_JWT_SECRET` (≥32 bytes) or `NAS_PAIR_PIN` (≥8 chars) is unset
- **BREAKING (production)**: hardcoded `DATABASE_URL` default removed
- Path sanitization in `scan.processor.ts` before spawn: rejects `..` segments, paths starting with `-`, and paths outside `NAS_LIBRARY_ROOT`
- Rate limiting: 5/min on `/api/auth/pair`, 10/min on `/api/auth/refresh`, 60/min on `/api/discovery/info`
- Discovery endpoint split: pre-auth response no longer leaks `tailscale_ip` or `lan_ips`
- IDOR fixes on `/api/downloads`: device fields derived from bearer, not from request body; cross-device PATCH and GET return 403
- bcrypt replaced with SHA-256 for token hashing (bcrypt silently truncates inputs >72 bytes, which broke refresh-token rotation)

### Changed

- `/health` split into `/livez` (always 200 if process is up) and `/readyz` (503 only when Postgres is unreachable; Redis-down stays 200)
- pg migrations are now transactional and idempotent via `schema_migrations` table; runner skips already-applied files
- `HealthModule` no longer defines its own parallel `pg.Pool`; imports `DatabaseModule`'s pool
- Downloads idempotency uses DB-side enforcement (not just service-side checks)

### Fixed

- BullMQ workers had no retry cap; a corrupt file would block the queue forever. Now: `attempts: 3`, exponential backoff, `removeOnComplete`/`removeOnFail`, `SidecarError` → `UnrecoverableError`
- mDNS bonjour bind failure crashed the Node process via unhandled `EventEmitter` error; now: `on('error', ...)` listener attached
- Search endpoint accepted unbounded `q` length (DoS vector via pgroonga); now: `@MaxLength(256)` + regex whitelist
- Two error envelope shapes coexisted (`{statusCode, message}` from default ValidationPipe vs `{error: {code, message}}` from auth); now: unified via global ValidationPipe
- `scan.processor` stdout/stderr had no size cap and no timeout; now: 64 MB cap, 60 s timeout, `SIGKILL` on overflow

### Issues closed

- #32, #33, #34, #44 (security blockers via PR #46)
- #35, #36, #37, #38, #45 (resilience blockers via PR #47)
- #39, #40, #41, #42, #43 (correctness + readability blockers via PR #48)

### Known limitations (deferred)

- OCR subcommand still returns `NOT_IMPLEMENTED` for `vision` and `tesseract` backends (PR3 follow-up)
- File-system watcher not yet implemented; workers are only enqueued manually (PR-2E follow-up)
- pgroonga defrag requires the `pg_cron` extension; `Dockerfile.pg` overlay provided for QNAP operators
- Mobile apps (iPad/iPhone React Native) — Phase 2 after Mac is solid

### Stats

- 92 commits since v0.1.0
- 97 files changed
- +22,676 / -3 LOC
- 165 tests passing

### Pull requests

- PR #46: security blockers — https://github.com/Sebailla/library/pull/46
- PR #47: resilience blockers — https://github.com/Sebailla/library/pull/47
- PR #48: correctness + readability — https://github.com/Sebailla/library/pull/48
- PR #49: release PR2 → main — https://github.com/Sebailla/library/pull/49

---

## [0.1.0] — 2026-06-27 — Python sidecar

First release of the `alejandria-v2` refactor. Adds the Python CLI sidecar that wraps the existing MVP extractors so any consumer (NestJS, Next.js server actions, Electron main process) can extract metadata without importing Python in-process.

### Added

- Python sidecar CLI: `python -m alejandria_sidecar extract <path>`
- 12 extractor wrappers: PDF, EPUB, DOCX, CHM, DjVu, CBZ, image (PNG/JPEG), audio (MP3/WAV/FLAC), video (MP4/AVI)
- OCR subcommand scaffolding with `--backend {vision|tesseract|unlimited}` and `--lang` flags (returns `NOT_IMPLEMENTED` for vision/tesseract for now)
- Dispatch layer with extension-based routing
- `--help` and `--version` flags
- `pyproject.toml` pinned to `requires-python = ">=3.11,<3.14"` so `pyobjc-framework-Vision` continues to install
- 93 pytest tests (Strict TDD, all green)
- README with per-format usage examples and error code reference

### Contract

- **Exit 0** = success including success-with-warnings envelopes
- **Exit 5** = path missing OR extractor raised unhandled exception
- Consumers must inspect the `warnings` array for partial-success conditions
- The contract was deliberately aligned with the MVP's warning-based extractor design (extractors never raise; failures go to `warnings`)

### Why not NestJS as the primary backend (yet)?

The NestJS backend went into v0.2.0 because the 4R review found 10 blockers in the initial PR2 implementation. The sidecar is stable enough to be used standalone by the Electron main process (PR3+).

### Known limitations

- EPUB and DOCX wrappers do NOT produce `FILE_UNREADABLE` for corrupt input — they return success envelopes with `warnings` populated. This is by design and matches the MVP contract.
- OCR subcommand returns `NOT_IMPLEMENTED` for `vision` and `tesseract` backends.
- File-system watcher not implemented.

### Stats

- 24 commits
- 31 files changed
- +3,338 / -35 LOC
- 93 tests passing

### Pull requests

- PR #8: PDF wrapper + dispatch foundation — https://github.com/Sebailla/library/pull/8
- PR #14: EPUB + DOCX tests — https://github.com/Sebailla/library/pull/14
- PR #15: image + cbz + audio tests — https://github.com/Sebailla/library/pull/15
- PR #16: video + chm + djvu tests — https://github.com/Sebailla/library/pull/16
- PR #17: OCR scaffolding + dispatch contract + README — https://github.com/Sebailla/library/pull/17
- PR #18: release PR1 → main — https://github.com/Sebailla/library/pull/18

---

## Migration guides

### From v0.1.0 to v0.2.0

**Production deployments** must set these env vars (no defaults allowed):

```bash
NAS_JWT_SECRET=<at-least-32-bytes-random>
NAS_PAIR_PIN=<at-least-8-chars>
DATABASE_URL=postgresql://user:pass@host:5432/db
NODE_ENV=production
```

`POSTGRES_HOST`, `REDIS_HOST`, `REDIS_PORT`, `PORT`, `NAS_LIBRARY_ROOT` keep their old defaults.

**Database migrations** are now transactional. Run once with `npm run migrate`. Re-runs are idempotent (the runner checks `schema_migrations`).

**API client errors** now follow a unified envelope:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "...", "details": [...] } }
```

instead of the default NestJS `{ "statusCode": 400, "message": [...] }` shape.

**Discovery endpoint split**: clients that previously called `GET /api/discovery/info` to get `tailscale_ip` and `lan_ips` must now call `GET /api/discovery/network` with a Bearer token. The pre-auth `GET /api/discovery/info` only returns `{mdns_name, port}`.
