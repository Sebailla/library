# Tasks: alejandria-v2

> Phase: tasks. Change: `alejandria-v2`. Artifact store: hybrid.
> TDD: strict (pytest + vitest). RED → GREEN → REFACTOR per task.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| LOC estimate | ~4600 total (PR1 ~600, PR2 ~1200, PR3 ~2000, PR4 ~800) |
| 400-line risk | Low per slice |
| Chained PRs | Yes |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

```
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Low
```

## Phase 1: Python sidecar (PR1)

- [x] 1.1 RED test `services/extractors-py/tests/test_cli.py` for JSON envelope + exit codes 0/2/3/4/5 with PDF/EPUB fixtures.
- [x] 1.2 GREEN implement `alejandria_sidecar/cli.py` argparse dispatcher with `schema_version=1` envelope.
- [x] 1.3 GREEN add re-export shims in `alejandria_sidecar/extractors/{pdf,epub,docx,chm,djvu,cbz,audio,video,image}.py`.
- [x] 1.4 GREEN add `alejandria_sidecar/ocr.py` wrapping `alejandria/ocr/` with `--backend vision|unlimited|tesseract`.
- [x] 1.5 REFACTOR pin `requires-python = ">=3.11,<3.14"` in `pyproject.toml` (pyobjc-Vision cap).
- [x] 1.6 DOCS write `services/extractors-py/README.md` with `alejandria extract <path>` usage + exit-code table.

## Phase 2: NAS backend (PR2)

- [ ] 2.1 RED test `services/nas-backend/test/health.e2e-spec.ts` asserts `GET /health` returns `{status:"ok"}`.
- [ ] 2.2 GREEN scaffold `services/nas-backend/` with `docker-compose.yml` for Postgres 16 + pgroonga + Redis.
- [ ] 2.3 GREEN add NestJS modules `auth`, `books`, `search`, `downloads`, `workers`, `discovery`, `database` with MVC layers.
- [ ] 2.4 GREEN write `migrations/0001_init.sql` with `BIGSERIAL`, `library_id`, pgroonga indexes, FTS5 trigger ports.
- [ ] 2.5 RED test `test/workers.e2e-spec.ts`: file appears → BullMQ job → row in `books`.
- [ ] 2.6 GREEN implement chokidar watcher + BullMQ workers spawning `'alejandria', ['extract', path]`.
- [ ] 2.7 GREEN add mDNS (`_alejandria._tcp`) + Tailscale IP discovery + PIN pairing endpoints.
- [ ] 2.8 GREEN add `GET /api/files/:id` with `Range` support + per-device download log table.
- [ ] 2.9 REFACTOR schedule nightly `pgroonga_index_defrag` via pg_cron in `migrations/0002_cron.sql`.
- [ ] 2.10 DOCS expose OpenAPI at `/api/docs` via `@nestjs/swagger`.

## Phase 3: Next.js 16 app (PR3)

- [ ] 3.1 RED test `apps/web/components/__tests__/BookList.test.tsx` (vitest + RTL) renders titles from fixture.
- [ ] 3.2 GREEN scaffold `apps/web/` with Next.js 16 + React 19 + Zustand + TanStack Query (App Router).
- [ ] 3.3 GREEN create `app/(catalog)/page.tsx` RSC + `app/(nas)/browse/page.tsx` RSC with `'use cache'` invalidation.
- [ ] 3.4 GREEN create `app/reader/[bookId]/page.tsx` `'use client'` + `next/dynamic({ ssr:false })` for pdfjs-dist and epub.js.
- [ ] 3.5 GREEN create `lib/reader/cfi-wrapper.ts` versioned wrapper around `epubcfi(...)` (epub.js minor-version compat).
- [ ] 3.6 GREEN add server actions `scanLocalFolder`, `downloadFromNas`, `pairDevice` in `app/_actions/`.
- [ ] 3.7 GREEN implement `packages/core/db/` with better-sqlite3 + FTS5; `source` tracks `nas_download|local_scan|sidecar`.
- [ ] 3.8 GREEN implement `lib/scan/local-pipeline.ts` that spawns the PR1 sidecar.
- [ ] 3.9 RED test `lib/__tests__/download-flow.test.ts`: mock INasClient, assert Range request + local upsert.
- [ ] 3.10 GREEN implement `lib/api/nas-client.ts` with Range-request download + tracking callback.
- [ ] 3.11 DOCS component docs in `packages/ui/` for BookList, BookDetail, Reader, NotesPanel, HighlightsPanel.

## Phase 4: Electron + iCloud + ISBN (PR4)

- [ ] 4.1 RED test `lib/__tests__/isbn-resolver.test.ts`: each of 7 layers independently + chain priority order.
- [ ] 4.2 GREEN implement `lib/isbn-resolver.ts` 7-layer pipeline: embedded, regex, OpenLibrary, Google Books, Vision OCR on cover, Unlimited-OCR cloud, national libs fuzzy.
- [ ] 4.3 GREEN implement `lib/sync/icloud.ts` with chokidar watcher + `ALEJANDRIA_ICLOUD_DIR` env override for non-Mac dev.
- [ ] 4.4 RED test `lib/__tests__/sync-conflict.test.ts`: two writes with different mtime assert last-write-wins by `updated_at`.
- [ ] 4.5 GREEN scaffold `apps/mac/` Electron 33 shell: `main.ts`, `preload.ts`, `renderer/` with `contextIsolation: true`.
- [ ] 4.6 GREEN configure `apps/mac/electron-builder.yml` with DMG target + `electron-updater` pointing at GitHub releases.
- [ ] 4.7 GREEN wire `apps/mac/main.ts` to spawn Python sidecar + resolve iCloud Drive path under `com~apple~cloudDocs/Alejandria/`.
- [ ] 4.8 GREEN wire `downloads` + `sync` IPC channels in `preload.ts` exposing `window.alejandria` API.
- [ ] 4.9 VERIFY launch `dist/Alejandria.app`; sync notes between two Macs in <5s; scan NAS book end-to-end.
- [ ] 4.10 DOCS end-user README + `BUILD.md` with codesigning + notarization steps for electron-builder.

## Implementation order

PR1 → PR2 → PR3 → PR4 merge to `main` directly. PR1 ships CLI before infra; PR2 workers spawn it; PR3 reads PR2 API; PR4 wraps PR3.

## Risks

ISBN layers 4-7 are net-new code; iCloud Drive replaces HTTP activity API and needs new e2e; `electron-updater` still requires codesign + notarize.