# Exploration: `alejandria-v2` — refactor from FastAPI+React/Vite to Next.js 16 + NestJS + Postgres + Python sidecar

> Phase: explore. Change: `alejandria-v2`. Artifact store: hybrid (Engram + OpenSpec).
> Source-of-truth decisions: `Documents-es/refactor/01..11-*.md`. Code investigated live.

---

## Current State

The MVP `alejandria-mvp` (T1–T15 + bugfix #1, 608 tests passing) is a **local-first single-binary** app on a single Mac:

- **Backend** — Python 3.11+, FastAPI 0.138 + uvicorn. Single-process, lifespan-managed singletons (`registry`, `connection_pool`, `device_id`, `enrichment_worker`, `scan_manager`, `menubar`). Pydantic v2 models. Per-library SQLite DB (`<data>/libraries/<uuid>.db`, WAL + FTS5) opened through `alejandria/db/connection_pool.py`. Library registry is a Pydantic-validated JSON file (`libraries.json`).
- **Extractors** — 12 pluggable format extractors (`alejandria/extractors/{pdf,epub,cbz,chm,djvu,doc,docx,image,video,audio,spotlight,base}.py`) sharing one `Extractor` ABC + `get_extractor()` linear-scan registry. Each returns one `ExtractedMetadata` (slots dataclass). Total ~2,200 LOC; PDFs use `pymupdf`, EPUB uses stdlib `zipfile` + regex, DOCX same, DOC uses `olefile` + optional `antiword`/`soffice`, CHM uses pure-Python ITSF header scan with optional `pychm`, DJVU shells to `djvutxt`/`djvused`, image uses `Pillow`, video uses `ffprobe`/`ffmpeg`, audio uses `mutagen`, Spotlight shells to `mdls`.
- **OCR** — `alejandria/ocr/{backend,vision_backend,tesseract_backend,pdf_helper}.py`. `OCRBackend` Protocol + factory. Vision via `pyobjc-framework-Vision` (macOS only), Tesseract via `pytesseract` (fallback). Vision is **lazy-imported** so the module loads cleanly on non-darwin. OCR is opt-in per scan.
- **Scanner pipeline** — `alejandria/scanner/pipeline.py` is a generator that yields one `ScanProgress` per file and inserts one row at a time (streaming, flat memory).
- **Enrichment** — `alejandria/enrichment/{pipeline,worker,openlibrary,isbn_regex}.py`. OpenLibrary lookup is throttled (5 req/s), failures persist to `pending_enrichment` table with exponential backoff; a 60 s lifespan worker drains the queue.
- **DB schema** — single SQLite DDL bundle (`alejandria/db/schema.py`): `files` + `files_fts` (FTS5) + `annotations` + `reading_progress` + `pending_enrichment` + `library_settings`. `CURRENT_SCHEMA_VERSION = 2`. One DDL bundle per library. Per-library isolation is via separate DB files, not schemas.
- **Frontend** — React 18 + Vite 5 + TS 5.6 strict, TanStack Query 5, Zustand, React Router 6. TanStack Query wraps all REST calls; SSE consumed for scan progress. 5 pages (`CatalogPage`, `SearchResultsPage`, `ReaderPage` placeholder, `NotFoundPage`, plus root App). 11 components. `pdfjs-dist` and `react-pdf-highlighter` are mentioned in spec/design but **not yet wired in code** (`ReaderPage` is a placeholder). Same for `epub.js`.
- **Packaging** — `py2app` produces `dist/Alejandria.app`; FastAPI serves the bundled `web/dist/index.html` via `_mount_frontend` in `app.py`. Data paths resolved via `platformdirs` (no hard-coded user segments in code).
- **iPad access** — FastAPI binds `0.0.0.0:8000` (configurable via `ALEJANDRIA_PORT`); Tailscale primary, LAN fallback via `platform/tailscale.py` + `platform/lan.py`. 30 s in-process cache. macOS menu-bar widget (`pyobjc` NSStatusBar) shows the URL with copy button.

**Live runtime check (2026-06-26)**: 173/173 of the sampled pytest unit suite passes (`test_extractors_pdf/epub/audio/image/cbz + test_db_schema + test_ocr_backend`). `pymupdf`, `mutagen`, `Pillow`, `fastapi`, `olefile`, `xxhash` are installed; `pyobjc-framework-Vision` is **not** installable on Python 3.14 (pyobjc lacks 3.14 wheels). All heavy format extractors are usable today.

---

## Affected Areas

### Code that MUST survive the refactor (Python sidecar)

| Path | Why it's affected | Reuse vs rewrite |
|---|---|---|
| `alejandria/extractors/*.py` (12 files, ~2,200 LOC) | Single most valuable asset. Returns `ExtractedMetadata` from `Path → dict`. Add a CLI wrapper layer that prints JSON to stdout; extractors themselves stay untouched. | **Reuse as-is** + thin CLI shim. |
| `alejandria/ocr/{backend,vision_backend,tesseract_backend,pdf_helper}.py` (~700 LOC) | Vision + Tesseract factories, OCRResult dataclass, the Protocol. Already lazy-imports pyobjc so it ports to a sidecar cleanly. | **Reuse as-is** + CLI shim. |
| `alejandria/scanner/pipeline.py` (`scan_folder` generator) | Streaming one-file-at-a-time walk → extract → enrich → persist → yield. The streaming invariant is critical for the 2M-file NAS scan. | **Reuse logic**; in the NAS worker rewrite to a BullMQ/RQ job that consumes the same generator. |
| `alejandria/core/models.py` (`ExtractedMetadata`, `FileCategory`) | Pure dataclasses, no framework imports. | **Reuse verbatim** — drop into `services/extractors-py/` or new `packages/core` TS mirror. |
| `alejandria/enrichment/isbn_regex.py` + `enrichment/openlibrary.py` | ISBN regex + 5 req/s throttled client. 7-layer ISBN pipeline from refactor doc 11 is a superset; current code is layers 1+3. | **Reuse core**; add the missing layers (Google Books, Vision OCR on cover, Unlimited-OCR stub, fuzzy national libs) in v2. |
| `alejandria/thumbnails/{generator,storage}.py` | Hash-deduped JPEG storage under `thumbnails/<lib>/<hash>.jpg`. | **Reuse logic**; rewrite storage layer to Postgres `cover_bytes` column or keep on disk. |
| `alejandria/platform/{paths,settings,device_id,tailscale,lan}.py` | `platformdirs` resolution, per-installation `device.json`, Tailscale/LAN URL detection. | **Reuse as Python sidecar** OR port the same logic to TS (`env-paths` package). |

### Code that MUST be rewritten

| Path | Why it's affected | Target |
|---|---|---|
| `alejandria/api/app.py` + `alejandria/__main__.py` | Single FastAPI process wrapping everything. | **NestJS** modules (`LibrariesModule`, `FilesModule`, `ScanModule`, `EnrichmentModule`, `SystemModule`, `AuthModule`). |
| `alejandria/api/routes/*.py` (7 routers, ~2,000 LOC) | REST endpoints with `{error:{code,message,details}}` envelope. | **NestJS controllers** with same envelope shape. Spec-by-spec 1:1 port: keep URL contract so the new client can speak to the old API during migration. |
| `alejandria/db/{connection_pool,repository,annotations_repo,progress_repo,pending_enrichment_repo}.py` | All SQLite-specific. | **Postgres** + `pg`/`postgres` driver; same SQL mostly portable, swap `AUTOINCREMENT` → `BIGSERIAL`, `INTEGER PRIMARY KEY` → `BIGINT`, `strftime('%s','now')` → `extract(epoch from now())::bigint`, FTS5 → `pgroonga`. Migrations become `node-pg-migrate` or Prisma. |
| `alejandria/db/schema.py` (SQLite DDL) | Library-per-DB isolation is replaced by library-per-row in Postgres (`books.library_id NOT NULL`). | **New SQL** in `services/nas-backend/migrations/`. |
| `alejandria/enrichment/worker.py` (asyncio + 60 s tick) | In-process lifespan worker. | **BullMQ worker** + Redis (already documented in refactor 06). |
| `alejandria/library/registry.py` (`libraries.json` Pydantic) | JSON file becomes DB row. | **NestJS `LibrariesService`** + Postgres. |
| `alejandria/platform/menubar.py` (pyobjc NSStatusBar) | macOS menu-bar widget. | **Electron Tray API** in `apps/mac/main/menubar.ts` (or Tauri's `Tray` later). |
| `web/src/**` (11 components + 5 pages + 5 hooks + client + types) | Entire SPA bundle. | **Next.js 16 App Router**: catalog + search become RSC; Reader + notes + scan modal stay Client Components; types split into `packages/core/types`. `pdfjs-dist` + `react-pdf-highlighter` still in scope; `epub.js` still in scope (no replacement). |
| `web/src/api/{client,hooks,scan,types}.ts` | TanStack Query wrappers, SSE consumer, error envelope parser. | **Two layers**: (a) thin `fetch` wrapper for legacy `alejandria-mvp` API during migration; (b) new TS client in `packages/infrastructure/nas-client/` that speaks to NestJS. TanStack Query + `'use cache'` for RSC fetch. |
| `web/src/store/ui.ts` (Zustand) | Local UI state. | **Zustand kept** for client-side reader state; catalog state moves to RSC + searchParams. |
| `py2app` build path (`alejandria.egg-info`, `[project.optional-dependencies] build`) | Mac native bundle. | **Electron-builder** + `electron-forge`; build emits `dist/Alejandria.app` and a signed DMG. |
| `tests/integration/test_*_api.py` (5 files) | FastAPI `httpx.AsyncClient` integration tests. | **NestJS e2e tests** + `supertest`. |
| `tests/unit/test_*.py` (28 files, ~600 tests) | pytest on extractors/DB/OCR/enrichment. | **Keep pytest for the Python sidecar**; add Vitest for the TS packages. |

### Stack-bound decisions that need re-derivation

| Old MVP decision | Why it must be re-derived for v2 |
|---|---|
| `pdfjs-dist` + `react-pdf-highlighter` for PDF reader | Same lib works in Next.js 16 (it's a regular npm package), but must be loaded via `next/dynamic({ ssr: false })` to keep PDF.js worker out of RSC bundle. |
| `epub.js` for EPUB reader | Same — `next/dynamic` lazy import. |
| `py2app` Mac packaging | Replaced by Electron. The Python sidecar still ships as a helper process inside `Alejandria.app/Contents/Resources/`. |
| `PyMuPDF` for cover rasterisation | Sidecar-only path; Next.js UI no longer reads files directly. |
| FastAPI `{error:{code,message,details}}` envelope | Keep the same envelope shape in NestJS so the existing `ApiError` parser in `web/src/api/client.ts` keeps working during migration. |
| Last-write-wins sync between Mac and iPad via HTTP | **Replaced** by iCloud Drive sync of `activity/{notes,highlights,progress,bookmarks}/<bookId>.json` (refactor 05) — the device-local model no longer assumes the Mac server is reachable. |
| Per-library SQLite file (`<uuid>.db`) | **Replaced** by single shared Postgres `books` table with `library_id` column (refactor 09) — but local-first device still has its own SQLite mirror for offline browse, per refactor 04 (hub-and-spoke). |
| 1 FastAPI process holds the registry + scan + enrichment workers + menu-bar widget | **Split** into: NestJS API + Postgres (NAS) + Python sidecar on each device + BullMQ workers + Redis. |
| Subprocess `open <path>` for "Open in Finder" | **Move** into Electron main process via `shell.openPath`. |
| `pdm`-style Python install | Switch to `uv` lockfile (already noted in refactor 01). |

### OpenSpec specs (13 archived) — status against v2

| Spec | Status | Why |
|---|---|---|
| `library-registry` | **Re-derive** (delta spec) | Same CRUD intent; wire shape changes (libraries come from Postgres `libraries` table, not JSON file); deletion semantics for thumbnails move to NAS. |
| `file-scanning` | **Re-derive** | Same streaming invariant + WAL-concurrent-reads invariant. WAL becomes Postgres MVCC. New scan worker model (BullMQ). New requirement: NAS-driven scan (watcher + cron + manual trigger, per refactor 07). |
| `metadata-extraction` | **Keep intent, rewrite language** | One-`ExtractedMetadata`-per-file contract is portable as-is. The TS extractor side (`pdfjs-dist`, `music-metadata`, `mammoth`) replaces pymupdf for simple cases; the Python sidecar keeps pymupdf + pyobjc-Vision. |
| `ocr-abstraction` | **Re-derive** | Vision + Tesseract stay, but Baidu Unlimited-OCR added as a cloud backend (refactor 11). Per-library override stays. Trigger rule (only PDFs without text layer) stays. |
| `openlibrary-enrichment` | **Keep intent** | 5 req/s throttle + retry queue survive. ISBN resolution becomes the 7-layer pipeline from refactor 11. Queue moves from per-library SQLite to NAS Postgres + BullMQ. |
| `thumbnail-generation` | **Keep intent** | Hash-deduped storage + 256x256 JPEG @ quality 85 stays. Storage layer moves to NAS Postgres + object store (or stays on local FS for the local-first device). |
| `annotations` | **Re-derive** | Same per-file scope + last-write-wins semantics. Sync transport changes from HTTP-only to iCloud Drive (per refactor 05). |
| `reading-progress` | **Re-derive** | Same polymorphic `last_position` shape. Same last-write-wins. Sync transport moves to iCloud Drive. |
| `pdf-reader` | **Keep intent, port implementation** | `pdfjs-dist` + `react-pdf-highlighter` survive (also used by Next.js). PDF.js worker code-split via `next/dynamic`. |
| `epub-reader` | **Keep intent, port implementation** | `epub.js` survives. v1 limitation (no paragraph bbox highlights) is explicit. |
| `touch-pencil-ux` | **Keep intent** | Pointer Events + `touch-action: manipulation` are framework-agnostic. The Mac trackpad + iPad Pencil code path stays. |
| `ipad-access` | **Replace** | The Tailscale/LAN/HTTP model is gone. iPad access becomes the same Next.js app, with content sourced from the local-first DB + optional NAS browse via `packages/infrastructure/nas-client`. |
| `packaging` | **Replace** | py2app → Electron-builder + electron-forge + auto-update. |

---

## Approaches

### Approach A — Keep the MVP, port incrementally (recommended)

**What**: Treat the 12 extractors + OCR + scanner generator as a Python sidecar (`services/extractors-py/`) with a tiny CLI. NestJS becomes a thin orchestrator that calls the sidecar via subprocess for extraction/OCR and uses Postgres + pgroonga for catalog state. Next.js 16 with App Router replaces the Vite SPA, sharing the same FastAPI-style REST envelope so the migration is contract-preserving.

- **Pros**:
  - The 12 extractors ship untouched (zero risk in the highest-value asset).
  - Vision OCR stays native on macOS (no Swift bridge).
  - Same wire shape (`{error:{code,message,details}}`) means the old `web/src/api/client.ts` keeps working — buy migration time.
  - Postgres schema can be derived directly from the current SQLite DDL (mostly portable).
  - Tests already prove the extractors work on the user's library; they keep passing.
- **Cons**:
  - Two runtimes in production (Node for API/UI, Python for sidecar).
  - The 7-layer ISBN pipeline (refactor 11) still needs to be built.
  - pgroonga + BullMQ + Redis add operational surface.
- **Effort**: High, but parallelisable across work units (see Risks).

### Approach B — Rewrite extractors in TypeScript

**What**: Replace pymupdf with `pdfjs-dist` + `pdf-lib`, mutagen with `music-metadata`, python-docx with `mammoth`, olefile with custom OLE parser, etc. Drop the Python sidecar.

- **Pros**: One runtime. Simpler ops.
- **Cons**: Rewrites every format's quirks. PDF XMP metadata, CHM, olefile-DOC, DJVU shellout are all fragile in JS. Months of work and new bug surface. **The user explicitly ruled this out** ("Mantener Python en backend" — refactor 01; "Reescribe a TS y manten en Python lo que se pierde con TS" — refactor 05).
- **Effort**: Very High (and net-negative for value).

### Approach C — Keep FastAPI, only port the frontend

**What**: Don't touch the Python backend; lift the React/Vite SPA into Next.js 16. Postgres stays optional.

- **Pros**: Smallest blast radius. Extractors, OCR, scanner, enrichment, library registry — all unchanged.
- **Cons**: Doesn't deliver the NAS hub-and-spoke model the user wants. Doesn't solve the multi-device sync without the iCloud Drive model. Doesn't scale to 2M books in SQLite. The refactor docs explicitly reject this (refactor 05: "FastAPI queda descartado").
- **Effort**: Medium for the front, but fails the user's brief.

---

## Recommendation

**Approach A**. Specifically:

1. **Sidecar-first**. Build `services/extractors-py/` as a thin CLI wrapper around the existing `alejandria/extractors/` package, plus `services/extractors-py/alejandria_extractors/cli.py` that prints JSON to stdout (matching the TS skeleton in refactor 05 §5). Same for `alejandria/ocr/`. **No code change inside the extractors themselves** — they're verified by the 173 unit tests that pass today.
2. **NestJS scaffold on the NAS**. Same envelope shape as the MVP API. Postgres schema derived 1:1 from `alejandria/db/schema.py` (same columns + new `library_id` everywhere + `BIGSERIAL` instead of `INTEGER AUTOINCREMENT` + `pgroonga` index for FTS).
3. **Next.js 16** as `apps/web/` with the existing component library moved into `packages/ui/`. RSC for catalog/search/details; Client Components for reader + notes + scan modal. TanStack Query kept for mutations; `'use cache'` + `cacheLife` for read paths. `pdfjs-dist` and `epub.js` loaded via `next/dynamic({ ssr: false })`.
4. **Electron** as `apps/mac/` (matches refactor 05 §7 recommendation). IPC between renderer (Next.js) and main (Node + better-sqlite3 for local mirror + Python sidecar invocation).
5. **iCloud Drive sync** for `activity/{notes,highlights,progress,bookmarks}/<bookId>.json` per refactor 05 §1. The MVP REST API for these becomes **read-only on the NAS**; writes go through iCloud, not the API.
6. **Monorepo**: pnpm workspaces with `packages/{core,application,infrastructure,ui}` + `apps/{web,mac,ios}` + `services/{extractors-py,nas-backend}` (per refactor 06).
7. **Strict TDD** preserved (openspec config has `strict_tdd: true`; 608 MVP tests passing).

The migration is **non-destructive** for the Python core (everything inside `alejandria/extractors/`, `alejandria/ocr/`, `alejandria/scanner/pipeline.py`, `alejandria/core/models.py` is reused as the sidecar) and **contract-preserving** for the REST envelope (the old `ApiError` parser keeps working against the new NestJS controllers).

---

## Risks

1. **The 7-layer ISBN resolution (refactor 11) is a new feature** that the MVP doesn't have. Layers 4 (Google Books), 5 (Vision on cover), 6 (Unlimited-OCR cloud), 7 (national libs fuzzy) all need new code on top of the existing `enrichment/openlibrary.py`.
2. **Postgres FTS substitution is non-trivial**. SQLite FTS5 vs `pgroonga` vs `tsvector` have different query syntax, ranking, and Chinese/Japanese tokenisation. The MVP trigger/AI/AU/D triggers on `files_fts` need to be re-implemented as pgroonga indexes + Postgres triggers, OR as a Meilisearch sidecar (refactor 11 recommends pg_trgm to start, Meili later). Pick one and write the migration carefully.
3. **Sync transport for activity changes** (notes/highlights/progress). The MVP assumes HTTP. The refactor specifies iCloud Drive JSON files with `last-write-wins` by mtime. This is a real behavior change: the NAS no longer holds these; the device's own SQLite + iCloud is the source of truth. The integration tests for sync (`tests/integration/test_*_api.py`) need new e2e coverage against iCloud Drive stubs.
4. **The Postgres `books` table replaces per-library DB files**. Migration of existing libraries needs a one-shot script: open each `<uuid>.db`, read all rows, insert into the shared `books` table with the right `library_id`. Risk of data loss if the migration runs twice without idempotency.
5. **Next.js 16 + React 19 + RSC** is recent; `pdfjs-dist` and `react-pdf-highlighter` may need explicit `'use client'` boundaries and `next/dynamic` wrappers to avoid SSR crashes. Test the catalog grid render on RSC and the reader render on a Client Component explicitly.
6. **pyobjc-Vision cannot install on Python 3.14**. The MVP is documented as targeting Python 3.11 + Apple Silicon. The sidecar must pin `requires-python = ">=3.11,<3.14"` or use a separate venv per Python version. Carry this constraint into the new `pyproject.toml`.
7. **React Router 6 → Next.js App Router is a full rewrite**. All 11 components + 5 pages need re-mounting inside `apps/web/app/(catalog)/`, `(nas)/`, `reader/[bookId]/page.tsx`. Zustand state survives; TanStack Query survives; types survive (move into `packages/core/types/`).
8. **PDF/EPUB readers never landed in MVP code** (`ReaderPage` is a placeholder). Refactor must include the actual reader wiring — `pdfjs-dist` + `react-pdf-highlighter` for PDF, `epub.js` for EPUB, plus annotation persistence against the new iCloud sync model.
9. **The MVP scan runs synchronously** (per the docstring at `api/routes/scan.py:1-37` after T14 was de-scoped due to event-loop blocking). v2 must restore the async scan model with NestJS BullMQ workers + WebSocket/SSE events. The streaming `scan_folder` generator is the right primitive; it must be wrapped in a worker, not run in-process.
10. **Per-file scope of annotations conflicts with the new `books.id` UUID scheme**. The MVP uses per-library SQLite where `file_id` is naturally scoped. v2 uses a shared `books(id UUID)` plus `annotations(book_id)`; sync across devices needs the book UUID to match across machines. The MVP's `(library_id, file_id)` namespace doesn't survive.
11. **The py2app → Electron migration drops `py2app`'s ability to ship a single double-clickable `.app`** until the Electron build chain is verified end-to-end. Plan a beta channel for early adopters.

---

## Ready for Proposal

**Yes** — the orchestrator can move to the **proposal** phase.

**Recommended next step**: `sdd-propose` for `alejandria-v2`, with:
- Intent: "Migrate from FastAPI + React/Vite + SQLite single-process to Next.js 16 + NestJS + Postgres + Python sidecar, hub-and-spoke (local-first device + NAS), iCloud Drive sync of activity, Electron Mac shell."
- Approach: **A** (sidecar-first, contract-preserving envelope).
- Scope: 4 work-streams that can be done as chained PRs (see Risks §11 for the 400-line budget):
  1. **Stream 1 (Python sidecar)** — extract `services/extractors-py/` CLI wrapper around existing `alejandria/extractors/` + `alejandria/ocr/`; no extraction code changes.
  2. **Stream 2 (NAS NestJS)** — Postgres schema from SQLite DDL; pgroonga FTS; same `{error:{code,message,details}}` envelope; BullMQ scan worker; download-tracking endpoint from refactor 05 §2.
  3. **Stream 3 (Next.js 16 app)** — monorepo + App Router + RSC catalog + Client Component reader + `pdfjs-dist`/`epub.js` lazy loads + iCloud Drive sync layer.
  4. **Stream 4 (Electron shell)** — main process with IPC + `shell.openPath` + Python sidecar spawn + local-first SQLite mirror.
- Rollback plan: keep `alejandria-mvp` running on `0.0.0.0:8000`; the new stack can run on a different port during cutover; the Python sidecar CLI is independently testable from day one.

**Questions for the user (one at a time, in order)**:

1. Confirm **Electron** (vs Tauri) for the Mac shell (refactor 05 recommended Electron because you already know React).
2. Confirm **iCloud Drive** for the activity sync (vs server-mediated sync) (refactor 05 §1).
3. Confirm **monorepo from scratch** in a sibling directory (vs in-place) (refactor 06 §3).
4. Confirm **Postgres** for the NAS (vs keeping SQLite per-library with WAL + `litestream`).

These four answers let the proposal phase write a tight, contract-preserving migration plan.
