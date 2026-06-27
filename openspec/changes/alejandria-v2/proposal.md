# Proposal: `alejandria-v2`

> Phase: propose. Change: `alejandria-v2`. Artifact store: hybrid (Engram + OpenSpec).
> Source of truth: `Documents-es/refactor/01..11-*.md`. Exploration: `openspec/changes/alejandria-v2/exploration.md`.

## Why

The MVP `alejandria-mvp` ships a single Mac app (FastAPI + React 18/Vite + SQLite + py2app, 608 tests passing, 50/119 planned tasks never applied). It cannot host a 2M-book NAS catalog, cannot sync reading activity across multiple devices, and bundles readers + OCR + packaging into one Python process that is hard to evolve.

`alejandria-v2` migrates to **Next.js 16 + React 19 + NestJS + Postgres + Electron + Python sidecar**, preserving the 12 extractors + Vision OCR untouched while adding:

- **Hub-and-spoke** (refactor 04): QNAP NAS as mother catalog (browse + download only); Mac/iPad are local-first devices.
- **iCloud Drive activity sync** (refactor 05): notes/highlights/progress/bookmarks mirror via Apple Books model.
- **7-layer ISBN resolution** (refactor 11): OpenLibrary + Google Books + Vision OCR on cover + Unlimited-OCR cloud.
- **pgroonga full-text search** in Spanish/CJK over the 2M-book catalog.

## What Changes

### Approach — 4 chained PRs (sidecar-first, contract-preserving)

| PR | Scope | Verification |
|---|---|---|
| **PR1 — Python sidecar** | Extract `services/extractors-py/` CLI wrapper around existing `alejandria/extractors/` + `alejandria/ocr/`. JSON in/out. Zero changes inside extractors. pyproject pins `requires-python = ">=3.11,<3.14"` for pyobjc-Vision. | All 173 existing extractor/OCR pytest unit tests pass; `alejandria extract path/to/book.pdf` returns valid JSON. |
| **PR2 — NAS NestJS** | `services/nas-backend/` with Postgres + pgroonga + Redis + BullMQ. New SQL derived from `alejandria/db/schema.py` (`BIGSERIAL`, `library_id` everywhere, `pgroonga` indexes, FTS5 triggers ported). Same `{error:{code,message,details}}` envelope so the old MVP client still works during cutover. Download-tracking endpoint, mDNS + Tailscale discovery, PIN pairing. | NestJS e2e + supertest green; 1000-book pgroonga query <100ms; migration script is idempotent. |
| **PR3 — Next.js 16 app** | `apps/web/` App Router. RSC for catalog/search/details; Client Components for reader + scan modal. `pdfjs-dist` + `epub.js` lazy-loaded via `next/dynamic({ ssr:false })`. Zustand + TanStack Query kept. `packages/core/types/` mirrors `alejandria/core/models.py`. | Catalog grid renders in RSC; PDF opens <2s; EPUB CFI tracking works. |
| **PR4 — Electron + iCloud + ISBN** | `apps/mac/` Electron shell: main process spawns Python sidecar + opens iCloud Drive paths. 7-layer ISBN pipeline + NAS browse-and-download UI in Next.js app. Final build emits `dist/Alejandria.app` (electron-builder) + signed DMG. | Notes sync between two Macs via iCloud Drive in <5s; NAS tracks downloads end-to-end; `Alejandria.app` launches. |

The MVP code at `/Users/sebailla/Documents/Proyectos/2026/biblioteca` stays untouched and runnable on `:8000`. The new stack lives in `/Users/sebailla/Documents/Proyectos/2026/biblioteca-v2/`.

### New Capabilities (will become full specs)

- `python-sidecar-cli`
- `nas-catalog-service`
- `nas-scanner-workers`
- `file-organization-pipeline`
- `isbn-resolution-pipeline`
- `nextjs-app-shell`
- `local-library-db`
- `library-browse-ui`
- `library-search-ui`
- `book-reader`
- `reading-activity`
- `reading-progress`
- `category-taxonomy`
- `nas-discovery-auth`
- `download-tracking`
- `nas-browse-download`

### Modified Capabilities (delta specs over existing MVP specs)

- `library-registry` — per-device local registry mirrored to NAS `libraries` table; deletion semantics move to NAS.
- `file-scanning` — local scan (Mac/iPad) + NAS scan (BullMQ worker + file watcher) split; same streaming invariant.
- `metadata-extraction` — extends to OpenLibrary/Google Books/Vision OCR + Unlimited-OCR for scanned PDFs.
- `ocr-abstraction` — adds Vision native + Unlimited-OCR cloud + Vision Kit as backends; per-library override kept.
- `openlibrary-enrichment` — kept; extends with 7-layer ISBN resolution priority chain.
- `annotations` — sync transport changes from HTTP to iCloud Drive JSON files (last-write-wins by mtime).
- `pdf-reader` / `epub-reader` — port implementation; lazy-load via `next/dynamic`; per-book UUID scope.
- `thumbnail-generation` — storage layer split: local FS on device, Postgres `cover_bytes` on NAS.
- `ipad-access` — replaced by the same Next.js app reading from local-first SQLite + optional NAS browse.
- `packaging` — py2app replaced by Electron-builder + electron-forge + auto-update.

## Out of Scope

- Mobile native apps (iPad/iPhone React Native) — Phase 2 after Mac is solid.
- Web app deployment for non-self-hosted users.
- Multi-user auth / family accounts (single-user only).
- Cloud hosting (self-hosted only on QNAP + Mac).
- Tauri migration (Electron is the chosen shell).

## Rollback Plan

- Each PR is independently revertible via `git revert`.
- MVP at `biblioteca/` remains untouched and runnable.
- New monorepo `biblioteca-v2/` is isolated on a sibling directory.
- The Python sidecar CLI is independently testable from day one (PR1 ships a working CLI before NestJS exists).
- During cutover the new stack runs on a different port; old `web/dist` keeps pointing at `:8000`.

## Success Criteria

- Sidecar CLI runs all 12 extractors, returns JSON, <500ms per file on warm cache.
- NestJS backend serves 1000 books queryable via pgroonga in <100ms.
- Next.js app opens a PDF in <2s, tracks progress to <1% drift.
- Notes sync between two Macs via iCloud Drive within 5s.
- NAS tracks downloads and persists catalog across restarts.
- 80%+ test coverage on core domain (extractors, scanner, ISBN, sync).

## Risks

1. **7-layer ISBN pipeline is net-new** — MVP has layers 1+3 only; layers 4-7 (Google Books, Vision on cover, Unlimited-OCR cloud, national libs fuzzy) must be built and tuned.
2. **pgroonga vs FTS5 mismatch** — query syntax, ranking, and CJK tokenisation differ; triggers need re-implementation. Pick pgroonga for v2, Meilisearch deferred.
3. **iCloud Drive sync transport change** — MVP API for activity becomes read-only on NAS; writes go to iCloud. Integration tests for sync need new e2e coverage.
4. **Per-library SQLite → shared Postgres migration** — one-shot script per `<uuid>.db`; idempotency required to avoid data loss on re-runs.
5. **pyobjc-Vision cannot install on Python 3.14** — sidecar must pin `>=3.11,<3.14`.
6. **Next.js 16 + React 19 RSC** — `pdfjs-dist` + `epub.js` need explicit `'use client'` boundaries + `next/dynamic` wrappers.
7. **PDF/EPUB readers never landed in MVP code** — `ReaderPage` is a placeholder; PR3 must wire both readers end-to-end.
8. **MVP scan runs synchronously** — v2 restores async with BullMQ + SSE/WebSocket; the streaming `scan_folder` generator is the right primitive.
9. **Per-file scope of annotations vs shared `books.id` UUID** — book UUID must match across devices; the `(library_id, file_id)` namespace doesn't survive.
10. **py2app → Electron loses single-double-click `.app`** until Electron build is verified end-to-end; plan a beta channel.

## Reference

- `openspec/changes/alejandria-v2/exploration.md` — full investigation
- `Documents-es/refactor/04-hub-and-spoke-mvc.md` — hub-and-spoke model + MVC layers
- `Documents-es/refactor/05-decisiones-finales.md` — iCloud sync + NAS download tracking
- `Documents-es/refactor/07-ciclo-vida-biblioteca-nas.md` — NAS lifecycle
- `Documents-es/refactor/08-estructura-de-carpetas.md` — monorepo layout
- `Documents-es/refactor/09-estructura-hibrida-y-categorias.md` — hybrid category structure
- `Documents-es/refactor/10-uniformidad-y-progreso.md` — progress model
- `Documents-es/refactor/11-ocr-pipeline-isbn-fulltext.md` — 7-layer ISBN + OCR pipeline

---

**Decision needed before apply**: Yes (per `sdd-phase-common` §E — 4 PRs each under 400 lines).
**Chained PRs recommended**: Yes.
**400-line budget risk**: Low per slice.
