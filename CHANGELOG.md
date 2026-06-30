# Changelog

All notable changes to **alejandria-v2** are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Planned
- Mobile apps (iPad/iPhone React Native)

### Fixed
- **monorepo + web + nas-backend (PR-3-fix-B)**: extracted the PR-2E sidecar hardening into a shared `@alejandria/sidecar` workspace package (`sanitizePath`, `spawnSidecar`, `SPAWN_TIMEOUT_MS = 60s`, `MAX_OUTPUT_BYTES = 64 MiB`). Both `apps/web/lib/scan/local-pipeline.ts` and `services/nas-backend/src/workers/scan.processor.ts` now consume the exact same helpers, so the web side no longer reopens argv injection / unbounded stdout / hung-Python interpreter failure modes (issue #60, BLOCKER).
- **web (PR-3-fix-B)**: `download-flow` wraps each NAS round-trip step (`getBook`, `startDownload`, `downloadFile`, `completeDownload`) in a new `withRetry({ attempts: 3, backoff: 'exp', baseMs: 250 })` helper, so a single 503/504/network drop no longer leaves a tracking row open on the NAS. Also wires resume support via `downloadBook({ start: bytesAlreadyOnDisk })` (issue #62, CRITICAL).
- **web (PR-3-fix-B)**: `nas-client.downloadFile` now streams chunks directly to disk (one `writeFile` call per network chunk) and enforces `MAX_DOWNLOAD_BYTES = 1 GiB`. On overflow the helper rejects with `DownloadOverflowError(code='DOWNLOAD_OVERFLOW')` and deletes the partial destination file so a failed retry doesn't leave stale bytes (issue #63, CRITICAL).
- **web (PR-3-fix-B)**: catalog `loadCatalog` and reader `loadReader` wrap their SQLite reads in try/catch — a SQLite lock contention or corruption 500s the routes no longer. The catalog renders the empty-state CTA; the reader renders a friendly fallback pointing at the recovery procedure (issue #64, CRITICAL).
- **web (PR-3-fix-B)**: `openLocalDb` runs `PRAGMA integrity_check` on the first open in a given process. A corrupted `library.sqlite` now throws a clear error early instead of failing every read downstream. The check is keyed by absolute path so a test suite that swaps `ALEJANDRIA_DATA_DIR` each test still sees a fresh check (issue #64, CRITICAL).

### Changed
- **web (PR-3-fix-A)**: reader route at `/reader/[bookId]` now mounts the real PDF. The page previously called `<Reader book={...} />` without forwarding `book.filePath`, so the `<Reader />` Client Component's `filePath`-gated `PdfSurface` branch was dead code in production (issue #59, BLOCKER).
- **web (PR-3-fix-A)**: `download-flow` reports the actual bytes received from the `nas-client.downloadFile` `onProgress` callback as `bytesTransferred` to the NAS — not the pre-flight `book.file_size_bytes` expected size, which diverges on partial / resumed / failed transfers (issue #65, CRITICAL).
- **web (PR-3-fix-A)**: consolidated two conflicting `BookRow` types. The canonical 8-field DB row lives in `@/lib/db/local-db`; the component-side 4-field type is now `BookListItem` in `@/components/BookList`. The internal `BookRowDb` shim has been dropped (issue #66, BLOCKER).

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

---

## [0.4.0] — 2026-06-29 — ISBN pipeline + iCloud sync + Electron shell

Fourth release of the `alejandria-v2` refactor. Closes PR4 (Electron + iCloud + ISBN). Comprises 4 chained PRs (PR-4A through PR-4D).

### Added

- **`apps/web/lib/isbn-resolver/`**: 7-layer ISBN resolution pipeline with strict priority order:
  1. Embedded metadata (PDF XMP / EPUB OPF)
  2. Regex over first 50,000 chars of extracted text
  3. OpenLibrary API
  4. Google Books API
  5. Apple Vision OCR on cover (provider seam, mock for now)
  6. Baidu Unlimited-OCR cloud (env-driven endpoint)
  7. National libraries (LoC + BNE + BN Argentina) fuzzy
- Each layer testable in isolation; orchestrator tries layers in order with LWW cache
- **`apps/web/lib/sync/`**: iCloud Drive activity sync (modelo Apple Books):
  - `path.ts` resolves `~/Library/Mobile Documents/com~apple~cloudDocs/Alejandria/` (overridable via `ALEJANDRIA_ICLOUD_DIR` env for non-Mac dev)
  - `writer.ts` writes JSON sync files with `version: 1` + `updatedAt`
  - `conflict-resolver.ts` last-write-wins by `updatedAt` with mtime tiebreaker
  - `watcher.ts` chokidar wrapper, `.json`-only, with defensive error listener
  - `sync-engine.ts` orchestrator: pull-on-startup + push-on-write + merge
- **`apps/mac/`**: Electron 33 shell:
  - `main.ts` with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
  - `preload.ts` exposes `window.alejandria` API via `contextBridge` (download, sync, scan, version)
  - `sidecar-manager.ts` manages Python sidecar lifecycle (lazy start, SIGTERM on quit)
  - `ipc-handlers.ts` registers IPC handlers
  - `forge.config.ts` electron-builder config (DMG arm64+x64, hardened runtime, electron-updater pointing at GitHub releases)
  - `electron-builder.yml` for production packaging
  - `scripts/verify-dist.cjs` post-build smoke test
- **`BUILD.md`** at monorepo root with codesign + notarize + publish-release flow
- End-user README at `apps/mac/README.md` (English + Spanish mirror)

### Stats

- 42 commits since v0.3.0
- 66 files changed
- +17,225 / -12 LOC
- 295 tests passing across 4 packages (apps/web, services/nas-backend, apps/mac, packages/sidecar)

### Pull requests

- PR #72: feat(web): 7-layer ISBN resolution pipeline
- PR #74: feat(web): iCloud Drive activity sync (modelo Apple Books)
- PR #76: feat(mac): Electron 33 shell scaffold with preload + IPC
- PR #78: feat(mac): production build config + codesign docs

See [CHANGELOG.md](https://github.com/Sebailla/library/blob/v0.4.0/CHANGELOG.md) for full details.

---

## [0.5.0] — 2026-06-30 — NAS backend closure (PR-N1..N8)

Fifth release of `alejandria-v2`. Closes the NAS backend story (PR2 + N1..N8). The NAS now exposes the full surface required by the v0.4 web app and the v0.4 Mac shell: range-resumable downloads, multi-library registry, download tracking with admin gate, admin scan with SSE + cooperative cancel, admin organize with idempotent moves, OpenAPI spec + Swagger UI + generated TS SDK client, Prometheus metrics + structured Pino logger, and real Mac IPC integrations with codesign + notarize.

### Added

- `GET /api/files/:book_id` with HTTP `Range` support (PR-N1)
- `HEAD /api/files/:book_id` returning `Content-Length` + `Accept-Ranges: bytes` (PR-N1)
- `GET /api/libraries` + `POST /api/libraries` + `GET /api/libraries/:id` + `PATCH /api/libraries/:id` + `DELETE /api/libraries/:id` + `PUT /api/libraries/:id/active` (PR-N2)
- `library_id` scoping on `books` (PR-N2)
- `devices.is_admin` column + `isAdmin()` repository method (PR-N3)
- `GET /api/downloads/by-book/:book_id` (admin-only) (PR-N3)
- `GET /api/me/downloads` (caller-scoped) (PR-N3)
- Admin gate on `/api/downloads/stats` returning 403 ADMIN_REQUIRED (PR-N3)
- Privacy check on `/api/downloads/by-device/:device_id` (PR-N3)
- `POST /api/admin/scan/full` + `POST /api/admin/scan/incremental` (PR-N4)
- `GET /api/admin/scan/status` + `GET /api/admin/scan/status/:job_id` (PR-N4)
- `POST /api/admin/scan/cancel/:job_id` (cooperative cancel) (PR-N4)
- `GET /api/admin/scan/events/:job_id` (SSE stream) (PR-N4)
- `POST /api/admin/organize/analyze` + `POST /api/admin/organize/execute` (idempotent) (PR-N5)
- `GET /api/admin/organize/plans/:plan_id` (PR-N5)
- `/api/docs` (Swagger UI) + `/api/docs-json` (raw spec) (PR-N6)
- Generated TS SDK client at `services/nas-backend/clients/ts/api.d.ts` (PR-N6)
- `GET /metrics` Prometheus exposition (PR-N7)
- Pino structured logger with `X-Request-Id` propagation via AsyncLocalStorage (PR-N7)
- Counters + histograms for HTTP requests, scan jobs, downloads (PR-N7)
- Real Mac downloader (native fetch) + real iCloud syncer (chokidar) (PR-N8)
- `scripts/sign-and-notarize.sh` codesign + `xcrun notarytool submit --wait` flow (PR-N8)
- `electron-updater` wired to read `GH_TOKEN` from env (PR-N8)

### Stats

- 84 commits since v0.4.0
- 117 files changed
- +18,356 / -105 LOC
- 273+ tests passing (out of 337 — 1 pre-existing failure unrelated to this block)

### 4R Review Outcome

The block was reviewed via 4R fan-out (R1 Risk + R2 Readability + R3 Reliability + R4 Resilience) and adjudicated via judgment-day (dual blind judges). Verdict: **APPROVED**. Three follow-up issues opened for non-blocking improvements:

- #98: collapse scan.module.ts producer literal into buildQueueOptions()
- #99: emit downloads_total{state="failed"} on exception path
- #100: add SSE heartbeat + e2e test for /api/admin/scan/events

### Pull requests

- PR #81: feat(nas-backend): GET /api/files/:id with HTTP Range support (N1)
- PR #83: feat(nas-backend): multi-library registry (N2)
- PR #85: feat(nas-backend): download tracking enhancements + admin gate (N3)
- PR #87: feat(nas-backend): admin scan endpoints (N4)
- PR #89: feat(nas-backend): admin organize endpoints (N5)
- PR #91: feat(nas-backend): OpenAPI spec + Swagger UI + TS SDK client (N6)
- PR #93: feat(nas-backend): observability — Prometheus metrics + structured logger (N7)
- PR #95: feat(mac): real IPC integrations + codesign + electron-updater wire (N8)

---

## [0.5.1] — 2026-06-30 — NAS backend follow-up fixes

Patch release of `alejandria-v2`. Three follow-up fixes that the 4R + judgment-day review identified as real issues but not release blockers for v0.5.0.

### Fixed

- **#99 — emit `downloads_total{state="failed"}` on exception path**: wired the previously-dead `INSTRUMENTED_DOWNLOADS_SERVICE` token in `DownloadsModule.providers`. Removed the inline `metrics.recordDownload(...)` calls from `DownloadsController` (which only emitted `started`, `in_progress`, `completed`). The adapter's try/catch now correctly emits the `failed` state on exception. (PR #102)
- **#98 — collapse scan.module.ts producer literal into `buildQueueOptions()`**: moved the canonical factory into a neutral file `services/nas-backend/src/workers/bullmq.config.ts`, added `getScanProducerDefaultJobOptions()` helper, and removed the dead `buildAdminScanWorkerOptions()` wrapper. Producer and worker retry budgets are now byte-identical by construction. (PR #103)
- **#100 — SSE heartbeat + e2e test for `/api/admin/scan/events`**: the events endpoint now emits `:keepalive\n\n` every 25 seconds. The endpoint also closes the connection when the worker delivers a terminal event (instead of leaving the client to disconnect). E2E test coverage added. SSE contract documented in README (4 invariants: terminal-state replay, no historical replay, heartbeat semantics, owner verification). (PR #104)

### Stats

- 3 chained PRs merged to develop
- +1,037 / -115 LOC (counting all 3 follow-ups)
- 339+ tests passing (no regressions from prior 337)
- Issues #98, #99, #100 closed

### Pull requests

- PR #102: `fix(nas-backend): emit downloads_total failed state on exception path`
- PR #103: `refactor(nas-backend): collapse scan.module.ts producer literal into buildQueueOptions()`
- PR #104: `feat(nas-backend): SSE heartbeat + e2e for /api/admin/scan/events`
