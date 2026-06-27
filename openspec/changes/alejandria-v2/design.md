# Design: `alejandria-v2`

> Phase: design. Change: `alejandria-v2`. Artifact store: hybrid (Engram + OpenSpec).
> Source of truth: `openspec/changes/alejandria-v2/proposal.md` + 27 specs. Living alongside MVP at `/Users/sebailla/.../biblioteca/`.

## Technical Approach

**Monorepo layout** (sibling to MVP, isolated dir `biblioteca-v2/`):

```
biblioteca-v2/
├── services/
│   ├── extractors-py/      PR1: Python sidecar CLI
│   └── nas-backend/        PR2: NestJS + Postgres + Redis + workers
├── apps/
│   ├── web/                PR3: Next.js 16 + React 19 App Router
│   └── mac/                PR4: Electron shell wrapping apps/web
└── packages/
    └── core/types/         Shared TS types mirroring alejandria/core/models.py
```

**How the 4 PRs integrate**: PR1 ships an independently testable CLI before any new infra exists. PR2 spawns that CLI from BullMQ workers over Postgres. PR3 consumes both NestJS (HTTP) and the local SQLite via a thin `INasClient` and a `LocalStore`. PR4 wraps `apps/web` in Electron, which re-uses the same sidecar spawn helper for local-scan orchestration.

**Python sidecar ↔ Node IPC**: `child_process.spawn('alejandria', ['extract', path])` with newline-delimited JSON on stdout. Rationale: zero new infra, exit-code-driven error model (0/2/3/4/5 already specced), survives crashes, easy to swap for a long-lived daemon later if latency requires it.

**Next.js ↔ NAS**: Server Components call `INasClient.search()` over fetch with HTTP/2 keep-alive. Download path uses `GET /api/files/{id}` with `Range` headers (already in spec). `'use cache'` invalidates on `book.updated` tag.

**Electron ↔ Next.js**: Next.js static-exported build is loaded via `file://` in a `BrowserWindow` (no Next.js server runtime in production). Main process owns sidecar spawning, iCloud Drive paths, and native dialogs. Renderer talks to main via typed IPC channels in `preload.ts`.

## Architecture Decisions

### Decision: Monorepo tool
**Choice**: pnpm workspaces. **Alternatives**: npm workspaces, Turborepo, Nx. **Rationale**: pnpm ships workspace + hoist + filters out of the box, symlinks keep the Python service isolated from Node `node_modules`, and `pnpm --filter` is the cleanest CI primitive. Turborepo adds cache value only when build times warrant it (we don't have 30+ packages).

### Decision: Python ↔ Node IPC
**Choice**: `spawn` CLI + JSON stdout, exit-code contract. **Alternatives**: gRPC, ZeroMQ, embedded HTTP server. **Rationale**: PR1 ships a CLI before PR2 exists; spawn survives worker crashes; the spec mandates deterministic exit codes (0/2/3/4/5) that are trivially scriptable. A long-lived gRPC daemon is the v3 path if p99 latency justifies it.

### Decision: OCR backend default
**Choice**: Apple Vision native on Mac (via sidecar `--backend vision`). **Alternatives**: Unlimited-OCR cloud from day 1, Tesseract fallback only. **Rationale**: Vision is free, on-device, and 0.91 confidence per spec. Unlimited-OCR stays opt-in via `UNLIMITED_OCR_ENDPOINT` (spec: layer 6 silently skipped if unset).

### Decision: Book matching across devices
**Choice**: `content_hash` first, then title+author fuzzy fallback. **Alternatives**: ISBN only (misses ISBN-less scans), filename only (collides on duplicates), UUID assigned by NAS (doesn't survive offline). **Rationale**: `content_hash` is content-derived → identical file on two devices maps to one row. Title+author fuzzy is the spec-mandated fallback when the hash diverges across edits.

### Decision: Sync transport for activity
**Choice**: iCloud Drive JSON files (`~/Library/Mobile Documents/com~apple~cloudDocs/Alejandria/activity/{notes,highlights,progress,bookmarks}/<book_uuid>.json`), last-write-wins by `updated_at`. **Alternatives**: HTTP API to NAS, bundle export/import, server-side sync. **Rationale**: spec mandates iCloud Drive (refactor 05), NAS API for activity is read-only (`ACTIVITY_IS_LOCAL_ONLY`), LWW is conflict-free for single-user.

### Decision: DB local (per device)
**Choice**: `better-sqlite3` + FTS5 in a single `<data_dir>/db.sqlite`. **Alternatives**: sql.js (browser-only), LevelDB (no SQL), file-per-library (rejected by `local-library-db` spec). **Rationale**: spec mandates single-DB-per-device with `source` column. `better-sqlite3` is sync + fast + native bindings, no async overhead in Next.js RSC.

### Decision: Cover image format
**Choice**: WebP primary + JPEG fallback. **Alternatives**: PNG only (too heavy), AVIF (Safari support limited in macOS 13), JPEG only (loses 30% size). **Rationale**: WebP is supported in macOS 11+ and Next.js `<Image>`; JPEG covers Electron's older WebView fallbacks.

### Decision: Reader CFI format
**Choice**: epub.js CFI (canonical). **Alternatives**: Readium SDK (overkill), custom locator (reinventing). **Rationale**: spec already mandates `epubcfi(...)` in the progress JSON; epub.js emits exactly that.

### Decision: PDF rendering
**Choice**: `pdfjs-dist` lazy via `next/dynamic({ ssr:false })` + `react-pdf-highlighter` for annotations. **Alternatives**: PDF.js directly (no annotation UI), PDFKit (server-side only), native PDFView (Electron only). **Rationale**: spec mandates highlight + note geometry; `react-pdf-highlighter` ships exactly that.

### Decision: FTS in NAS
**Choice**: pgroonga on Postgres 16. **Alternatives**: Meilisearch (extra service), Typesense (same), Elasticsearch (heavy), FTS5 (Postgres already used → but no CJK + Spanish). **Rationale**: spec requires Spanish + CJK tokenization out of the box; pgroonga is the only Postgres-native option with both. Single dependency, no extra container.

### Decision: Worker queue
**Choice**: BullMQ + Redis. **Alternatives**: Celery (Python only, wrong stack), RabbitMQ (no Node SDK niceness), custom (reinventing). **Rationale**: spec already uses Redis for BullMQ; NestJS has `@nestjs/bull` first-class integration; 1000-job queue is one Redis instance.

### Decision: NAS discovery
**Choice**: mDNS (`_alejandria._tcp`) on LAN + Tailscale IP fallback. **Alternatives**: Static IP (brittle), Cloudflare Tunnel (overkill for self-hosted LAN). **Rationale**: mDNS works out of the box on QNAP + Mac without configuration; Tailscale covers WAN. Spec leaves the pairing flow as PIN.

## Data Flow

### 1. Local scan (Mac)
```
FileWatcher ──▶ LocalStore.scanFolder()
                   │
                   ├─▶ sidecar spawn('extract', path) ─▶ JSON metadata
                   ├─▶ sidecar spawn('ocr', path) [if scanned PDF]
                   ├─▶ thumbnail write to <data_dir>/covers/<hash>.webp
                   └─▶ better-sqlite3 upsert into books / books_fts
                            │
                            └─▶ (debounced 2s) iCloud Drive JSON mirror
```

### 2. NAS scan (BullMQ workers)
```
watchdog on /share/biblioteca/raw ──▶ BullMQ enqueue
                                          │
        BullMQ worker (× CPU count) ──────┘
                   │
                   ├─▶ sidecar spawn('extract') ─▶ metadata
                   ├─▶ pgroonga upsert into books + book_categories
                   ├─▶ cover stored at /share/.../metadata/covers/<id>.webp
                   └─▶ ISBN chain (7 layers, see isbn-resolution-pipeline spec)
```

### 3. Download flow (Mac ↔ NAS)
```
User clicks Download in Next.js UI
   │  Server Action
   ▼
INasClient.download(bookId, token)
   │  GET /api/files/{id}  Range: bytes=0-     (bearer token)
   ▼
NAS streams bytes with 206 Partial Content support
   │  bytes ──────────────────────────────────────┐
   ▼                                                ▼
Local pipeline: extract → cover → better-sqlite3 upsert
                                                  (source='nas_download')
```

### 4. iCloud Drive sync (Mac ↔ Mac)
```
Mac A: user creates note at CFI X
   │
   ├─▶ better-sqlite3 row in annotations (immediate)
   │
   └─▶ 2s debounce ──▶ write ~/.../Alejandria/activity/notes/<book_uuid>.json
                              │
                              ▼
                      Apple iCloud Drive propagates (<5s)
                              │
                              ▼
                      Mac B: chokidar watches iCloud dir
                              │
                              └─▶ upsert into annotations (LWW by updated_at)
```

## File Changes

### PR1 — Python sidecar
| File | Action | Description |
|---|---|---|
| `biblioteca-v2/services/extractors-py/pyproject.toml` | Create | `requires-python = ">=3.11,<3.14"` for pyobjc-Vision; entry point `alejandria`. |
| `biblioteca-v2/services/extractors-py/alejandria_sidecar/cli.py` | Create | argparse + registry dispatch; exit codes 0/2/3/4/5; `schema_version=1` envelope. |
| `biblioteca-v2/services/extractors-py/alejandria_sidecar/extractors/{pdf,epub,docx,chm,djvu,cbz,audio,video,image,ocr}.py` | Create | Thin re-exports of `alejandria/extractors/*` (no logic copy). |
| `biblioteca-v2/services/extractors-py/tests/test_cli.py` | Create | pytest against fixture files; asserts JSON shape + exit codes. |

### PR2 — NAS NestJS
| File | Action | Description |
|---|---|---|
| `biblioteca-v2/services/nas-backend/package.json` | Create | NestJS 10, `@nestjs/bull`, `pg`, `ioredis`, `pgroonga`. |
| `biblioteca-v2/services/nas-backend/src/main.ts` | Create | App bootstrap, error envelope global filter, CORS for local app. |
| `biblioteca-v2/services/nas-backend/src/{auth,books,search,downloads,workers,discovery,database}/{module,controller,service}.ts` | Create | Layered per MVC (refactor 04). |
| `biblioteca-v2/services/nas-backend/docker-compose.yml` | Create | Postgres 16 + pgroonga + Redis. |
| `biblioteca-v2/services/nas-backend/migrations/0001_init.sql` | Create | `BIGSERIAL`, `library_id` everywhere, pgroonga indexes, FTS5 trigger ports. |
| `biblioteca-v2/services/nas-backend/test/*.e2e-spec.ts` | Create | supertest + Testcontainers Postgres. |

### PR3 — Next.js 16 app
| File | Action | Description |
|---|---|---|
| `biblioteca-v2/apps/web/package.json` | Create | Next.js 16, React 19, `pdfjs-dist`, `epub.js`, `@tanstack/react-query`, `zustand`. |
| `biblioteca-v2/apps/web/app/(catalog)/page.tsx` | Create | RSC catalog grid with `'use cache'`. |
| `biblioteca-v2/apps/web/app/(nas)/browse/page.tsx` | Create | RSC NAS browse with pgroonga search box (Client Component child). |
| `biblioteca-v2/apps/web/app/reader/[bookId]/page.tsx` | Create | `'use client'` + `next/dynamic({ ssr:false })` for both readers. |
| `biblioteca-v2/apps/web/components/{BookList,BookDetail,Reader,NotesPanel,HighlightsPanel}.tsx` | Create | Layer 1 (View) per refactor 04. |
| `biblioteca-v2/apps/web/lib/{api-client,db,nas-client,sync,isbn-resolver}.ts` | Create | Layer 4 (Infrastructure). |
| `biblioteca-v2/packages/core/types/{book,author,category,saga,note,highlight,bookmark,progress}.ts` | Create | Mirrors `alejandria/core/models.py` 1:1. |
| `biblioteca-v2/apps/web/components/__tests__/*.test.tsx` | Create | vitest + RTL. |

### PR4 — Electron shell + iCloud + ISBN
| File | Action | Description |
|---|---|---|
| `biblioteca-v2/apps/mac/{main,preload,renderer}/` | Create | Electron 33 + `contextIsolation: true`. |
| `biblioteca-v2/apps/mac/electron-builder.yml` | Create | DMG + auto-update target. |
| `biblioteca-v2/apps/web/lib/isbn-resolver.ts` | Modify | 7-layer chain (embedded → regex → OL → Google → Vision OCR → Unlimited-OCR → national libs). |
| `biblioteca-v2/apps/web/lib/sync.ts` | Modify | iCloud Drive transport + chokidar watcher. |
| `biblioteca-v2/apps/mac/infrastructure/sidecar-spawn.ts` | Create | Typed wrapper over `child_process.spawn('alejandria', …)` shared with NestJS. |

## Interfaces / Contracts

### Sidecar JSON envelope (schema_version=1)
```json
{
  "schema_version": 1,
  "type": "extract",
  "path": "/abs/path/book.pdf",
  "format": "pdf",
  "title": "Ficciones",
  "author": "Jorge Luis Borges",
  "isbn_candidates": ["978-84-376-0494-7"],
  "pages": 224,
  "size_bytes": 1048576,
  "content_hash": "sha256:...",
  "warnings": [],
  "duration_ms": 47
}
```
`ocr` mode returns `{schema_version, type: "ocr", text, confidence, backend, lang, duration_ms}`.

### NestJS API (subset)
| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/search?q=&limit=&offset=` | bearer | `{data:{hits:[], total, limit, offset}}` |
| GET | `/api/books/:id` | bearer | `{data:{book}}` / `{error:{code:"BOOK_NOT_FOUND",…}}` |
| GET | `/api/files/:id` | bearer | 200 stream / 206 Range / 404 |
| GET | `/api/categories` | bearer | `{data:{tree}}` |
| POST | `/api/auth/pair` | none | `{data:{device_id, bearer_token}}` |
| GET | `/health` | none | `{status:"ok"}` |

### Next.js Server Actions
- `scanLocalFolder(path)` → enqueues a local Bull-lite scan
- `downloadFromNas(bookId)` → calls INasClient + writes to local pipeline
- `pairDevice(pin)` → POST /api/auth/pair, stores token in OS keychain via Electron IPC

### Electron IPC channels (preload exposes `window.alejandria`)
- `alejandria:scan-local` → main spawns sidecar loop
- `alejandria:open-icloud-dir` → main returns `~/.../Alejandria/activity/` path
- `alejandria:dialog-folder` → main shows native `dialog.showOpenDialog`

### iCloud Drive JSON schemas
```
notes/<book_uuid>.json     {book_uuid, entries:[{id, cfi, body, created_at, updated_at, device_id}]}
highlights/<book_uuid>.json {book_uuid, entries:[{id, cfi, text, color, geometry, created_at, updated_at}]}
progress/<contentHash>.json {book_uuid, last_position, percentage, last_read_at, device_id}
bookmarks/<book_uuid>.json  {book_uuid, entries:[{id, cfi, label, created_at}]}
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Sidecar CLI | JSON shape, exit codes 0/2/3/4/5, schema_version | pytest fixtures against `tests/fixtures/*.pdf` |
| NestJS API | Endpoints + pgroonga query plan + Range | supertest + Testcontainers Postgres with pgroonga image |
| BullMQ workers | Idempotent re-scan on hash, error isolation | worker test harness with mock sidecar |
| Next.js RSC | Catalog grid renders, `'use cache'` invalidation | vitest + RTL with mocked INasClient |
| Next.js Client | Reader dispatch, debounced progress save | vitest + RTL + fake timers |
| iCloud sync | LWW conflict resolution | vitest with mocked `fs.watch` |
| ISBN pipeline | Each layer independently + chain order | vitest with mocked `fetch` per layer |
| Electron main | IPC handlers, sidecar spawn | Playwright for Electron |

## Migration / Rollout

**Phase 0 (cutover day 0)**: Both stacks run in parallel — old FastAPI on `:8000`, new NestJS on `:3000`. Both honour the same `{error:{code,message,details}}` envelope so the legacy client keeps working.

**Phase 1 (cutover week 1)**: Electron app points to NestJS by default; on `{error:{code:"NAS_UNREACHABLE"}}` it falls back to FastAPI for reads.

**Phase 2 (cutover week 2-6)**: FastAPI deprecated, kept for rollback only. Monitoring on `/health` of both.

**Phase 3 (cutover day +30)**: FastAPI removed; `alejandria/` kept read-only as historical reference.

**Data migration**: One-shot Python script `migrate_sqlite_to_postgres.py` per `<uuid>.db` — idempotent (skips rows where `content_hash` already exists), batched 1000 rows/tx.

## Open Questions

- [ ] iCloud Drive path on non-Mac dev machines — does the chokidar watcher need a configurable override?
- [ ] pgroonga index bloat on 2M rows — reindex strategy (daily cron? pgroonga's `pgroonga_index_defrag`?)?
- [ ] Electron auto-update channel — signed DMG via Sparkle or `electron-updater`?
- [ ] CFI persistence: are Readium CFI strings stable across epub.js minor versions, or do we need a versioned wrapper?
- [ ] BullMQ workers on the NAS — same container as the API, or separate for resource isolation?
