# biblioteca-v2

Monorepo for the next iteration of the `alejandria` personal-library
project. Lives alongside the legacy MVP at
`../biblioteca/` and replaces it incrementally — the MVP stays
read-only as the reference implementation.

## Latest release

**v0.5.1** (2026-06-30) — NAS backend follow-up fixes (#98 #99 #100). See
the [GitHub Releases](https://github.com/Sebailla/library/releases)
for the full changelog. Local user guide: [Documents-es/USER_GUIDE.md](Documents-es/USER_GUIDE.md)
(in Spanish — the project uses Spanish for end-user docs).

## Layout

```
biblioteca-v2/
├── services/
│   ├── extractors-py/   v0.1.0 — Python sidecar CLI (12 extractor wrappers + OCR)
│   └── nas-backend/     v0.2.0/v0.5.0/v0.5.1 — NestJS + Postgres + Redis + workers + admin surface
├── apps/
│   ├── web/             v0.3.0 — Next.js 16 + React 19 App Router (browse, search, reader, ISBN, iCloud sync)
│   └── mac/             v0.4.0/v0.5.0 — Electron 33 shell wrapping apps/web (IPC, codesign, notarize, electron-updater)
└── packages/
    ├── core/types/      Shared TS types mirroring alejandria/core/models.py
    └── sidecar/         Shared sidecar spawn + path sanitization (used by nas-backend + apps/web)
```

## PR status

| PR | Slice | Status | Release |
|----|-------|--------|---------|
| PR1 | Python sidecar (`services/extractors-py/`) | Merged | v0.1.0 |
| PR2 | NAS NestJS backend (`services/nas-backend/`) | Merged | v0.2.0 |
| PR-3A | Next.js 16 scaffold + RSC catalog browse (`apps/web/`) | Merged | v0.3.0 |
| PR-3B | Real local SQLite + FTS5 + scan pipeline + PDF reader (`apps/web/`) | Merged | v0.3.0 |
| PR-3C | NAS client + Range-request download + server actions + pdfjs (`apps/web/`) | Merged | v0.3.0 |
| PR-4A | 7-layer ISBN resolution pipeline (`apps/web/lib/isbn-resolver/`) | Merged | v0.4.0 |
| PR-4B | iCloud Drive activity sync layer (`apps/web/lib/sync/`) | Merged | v0.4.0 |
| PR-4C | Electron 33 shell + preload + IPC (`apps/mac/`) | Merged | v0.4.0 |
| PR-4D | Production build + codesign + electron-updater (`apps/mac/`) | Merged | v0.4.0 |
| PR-N1..N8 | NAS backend closure (Range download, multi-library, admin scan, admin organize, OpenAPI, observability, real Mac IPC) | Merged | v0.5.0 |
| Follow-ups | BullMQ collapse, downloads_total{state=failed}, SSE heartbeat | Merged | v0.5.1 |

## Running `apps/web/` (PR-3C)

The web app is the Next.js 16 + React 19 shell. It serves the local
library catalog at `/`, the NAS browse shell at `/browse`, the
reader at `/reader/[bookId]`, and a "Pair with NAS" CTA on the
home page. The catalog and NAS browse routes are React Server
Components with the `'use cache'` directive required by the
`nextjs-app-shell` spec; the reader is a Client Component so
`pdfjs-dist` can lazy-load in the browser only.

```bash
cd apps/web
npm install
npm run dev    # http://localhost:3001
```

### Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Start the Next.js dev server on **port 3001** (the NAS backend reserves `:3000`). |
| `npm run build` | Production build via Turbopack. Outputs `.next/`. |
| `npm start` | Run the production build on port 3001. |
| `npm test` | Vitest one-shot run (component + lib tests under `**/__tests__/`). |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run typecheck` | `tsc --noEmit` against the strict tsconfig. |
| `npm run lint` | `next lint` via `eslint-config-next`. |

## Running `services/nas-backend/`

The NAS backend is the central catalog, download tracking, and admin surface. It runs in Docker via `docker-compose.yml` (Postgres 16 + pgroonga + Redis + the API).

```bash
cd services/nas-backend
docker compose up -d        # postgres + redis + nas-backend
npm install                  # if running tests locally
npm run build                # compile TS to dist/
npm run start:prod           # node dist/main.js on port 3000
```

### Scripts

| Script | What it does |
|--------|--------------|
| `npm run build` | Compile via `nest build` → `dist/` |
| `npm start` | `nest start` (dev) |
| `npm run start:dev` | `nest start --watch` (hot-reload) |
| `npm run start:prod` | `node dist/main.js` (production) |
| `npm run migrate` | Apply pending SQL migrations (idempotent via `schema_migrations` table) |
| `npm test` | Jest one-shot run (e2e + repository contracts + observability) |
| `npm run openapi:generate` | Regenerate the TS SDK client at `clients/ts/api.d.ts` from the live spec |
| `npm run openapi:check` | CI guard: fails if the generated SDK is out of sync with the live spec |

## Running `services/extractors-py/`

The Python sidecar CLI wraps the 12 MVP extractors and OCR backends. Pin the interpreter to **3.11 ≤ Python < 3.14** (pyobjc-Vision wheel limitation).

```bash
cd services/extractors-py
python -m venv .venv && source .venv/bin/activate
pip install -e .[dev]
alejandria-sidecar --help
alejandria-sidecar extract /path/to/book.pdf    # prints JSON envelope
pytest                                          # 93+ tests
```

The sidecar is consumed by both the web app (`apps/web/lib/scan/local-pipeline.ts`) and the Electron shell (`apps/mac/src/sidecar-manager.ts`).

## Running `apps/mac/` (Electron)

The Electron 33 shell wraps the web app and adds native capabilities (sidecar spawn, iCloud Drive sync, file system access, auto-update).

```bash
cd apps/mac
npm install
npm start                                  # launch dev mode (loads http://localhost:3001)
npm run package                             # produce dist/Alejandria.app (macOS only)
npm run dist:mac:sign                       # codesign + notarize (requires Apple Developer ID)
npm test                                    # vitest run
```

See [apps/mac/README.md](apps/mac/README.md) for end-user install + first-run instructions. See [BUILD.md](BUILD.md) for codesign + notarize + GitHub releases publication.

### Routes

| Path | Component | Notes |
|------|-----------|-------|
| `/` | `app/(catalog)/page.tsx` | RSC. Reads `lib/db/local-db.ts`. Cached for 1h with `cacheTag('local-library')`. Renders a "Pair with NAS" form (PR-3C) so the user can mint a bearer token. |
| `/browse` | `app/(nas)/browse/page.tsx` | RSC. Reads `lib/api/nas-client.ts` via `GET /api/books`. Cached for 1h with `cacheTag('nas-catalog')`. Renders an empty list when the NAS is offline. |
| `/reader/[bookId]` | `app/reader/[bookId]/page.tsx` | Client Component. Mounts `<Reader />` with `<ProgressBar />` and a lazy-loaded `<PdfViewer />` (`pdfjs-dist` via `next/dynamic({ ssr:false })`). |
| `/livez` | `app/livez/route.ts` | Process liveness probe. Always 200 once the Next.js worker is up. Per Kubernetes convention does NOT touch the database. |
| `/readyz` | `app/readyz/route.ts` | Readiness probe. Runs `PRAGMA quick_check` against the local SQLite. Returns 200 when healthy, 503 with `{checks: {sqlite: '<error>'}}` when the DB is corrupt or unreadable. |

### NAS client (PR-3C)

`lib/api/nas-client.ts` ships a dependency-injected `fetch` HTTP
client that implements the full PR-2 wire surface. Every method
returns a strongly-typed response; callers never touch `fetch`
directly.

| Method | Endpoint | Auth |
|--------|----------|------|
| `pair({ pin, deviceName })` | `POST /api/auth/pair` | Public |
| `refresh()` | `POST /api/auth/refresh` | Public (sends current token) |
| `listBooks({ page, limit, authorId, format, language })` | `GET /api/books` | Bearer |
| `getBook(id)` | `GET /api/books/:id` | Bearer |
| `search(q, { limit, offset })` | `GET /api/search` | Bearer |
| `listCategories()` | `GET /api/categories` | Bearer |
| `getDiscoveryInfo()` | `GET /api/discovery/info` | Public |
| `getDiscoveryNetwork()` | `GET /api/discovery/network` | Bearer |
| `startDownload({ bookId, deviceId, deviceName, userId, fileSizeBytes })` | `POST /api/downloads` | Bearer |
| `completeDownload(id, { completed, bytesTransferred })` | `PATCH /api/downloads/:id` | Bearer |
| `downloadFile(bookId, destPath, onProgress, options?)` | `GET /api/files/:id` (Range) | Bearer |

Construction:

```ts
import { createNasClient } from '@/lib/api/nas-client'

const client = createNasClient({
  baseUrl: process.env.ALEJANDRIA_NAS_URL, // optional, defaults to http://localhost:3000
  token: '<jwt>',                          // optional, set after pair/refresh
  fetch: globalThis.fetch,                 // optional, defaults to global fetch
})
```

### Download flow (PR-3C)

`lib/download/download-flow.ts` orchestrates the NAS-side of a
book download:

1. `INasClient.getBook` — resolve metadata
2. `INasClient.startDownload` — open the tracking row
3. `INasClient.downloadFile` — stream the bytes with `Range: bytes=0-`
4. `openLocalDb().insertBook` — persist the row so the reader can find it
5. `INasClient.completeDownload` — close the tracking row

```ts
import { createNasClient } from '@/lib/api/nas-client'
import { downloadBook } from '@/lib/download/download-flow'

const client = createNasClient({ token: '<jwt>' })
const result = await downloadBook({
  bookId: 7,
  deviceId: 'web-uuid',
  deviceName: 'web-MacBook Pro',
  userId: 'self',
  destPath: '/path/to/ficciones.pdf',
  nasClient: client,
})
```

The resumable Range transport lives in
`lib/download/range-client.ts` (`downloadWithRange(url, destPath,
fetchImpl, options)`). It accepts 200 OK (no Range support) and
206 Partial Content, fires a per-chunk `onProgress` callback, and
returns the total bytes written.

### Server Actions (PR-3C)

`app/_actions/nas-actions.ts` exposes thin Server Actions the
RSC pages call from `<form action={…}>`:

| Action | What it does |
|--------|--------------|
| `pairDevice(formData)` | Reads `pin` + `deviceName`; returns a `Result<NasPairResponse, ErrorMessage>`. |
| `refreshToken(formData)` | Reads `token`; returns a `Result<NasPairResponse, ErrorMessage>`. |
| `downloadFromNas(formData)` | Reads `bookId` + device attribution; runs `downloadBook`; returns a `Result<DownloadBookResult, ErrorMessage>`. |
| `scanLocalFolder(formData)` | Reads `filePath`; runs `scanFile`; returns a `Result<BookRow, ErrorMessage>`. |

All four return a discriminated union so the calling page renders
errors without `try/catch` noise.

### PDF viewer (PR-3C)

`components/PdfViewer.tsx` lazy-loads `pdfjs-dist`, configures
the worker via `URL(new URL(..., import.meta.url))`, and renders
the current page to a `<canvas>`. The component exposes:

- `currentPage` — controlled page number
- `onPageChange(page)` — fired by the prev/next buttons
- `onError(error)` — fired on render rejection so the parent can
  surface a fallback UI

The Reader wires `onPageChange` to a local `currentPage` state
and the route's persistence layer.

### Local SQLite

`lib/db/local-db.ts` opens a single SQLite database at
`<ALEJANDRIA_DATA_DIR>/library.sqlite` (default
`apps/web/data/library.sqlite`). The file is created with the full
schema on first open — `books`, `authors`, `categories`,
`book_categories`, `sagas`, `book_sagas`, `reading_progress`, plus
an FTS5 virtual table (`books_fts`) synced by triggers over
`books.title` + `books.excerpt`. `data/library.sqlite` is gitignored.

| Helper | What it does |
|--------|--------------|
| `openLocalDb()` | Opens (or creates) the DB and returns the helper object. Runs `PRAGMA integrity_check` on the first open in the process; subsequent opens skip the check (it's O(file-size)). |
| `db.insertBook(input)` | Insert one book. Throws on duplicate `id` / `content_hash`. |
| `db.findById(id)` | Fetch one book by id, or `null` if missing. |
| `db.listBooks()` | List all books in newest-first `rowid` order. |
| `db.searchBooks(query)` | FTS5 prefix-match search over `title` + `excerpt`. |
| `db.insertProgress(bookId, page, pct)` | Upsert reading progress. |
| `db.getProgress(bookId)` | Fetch reading progress, or `null` if missing. |

#### `library.sqlite` corruption recovery

If `openLocalDb` throws with a message like `integrity_check
failed for …/library.sqlite`, the file is corrupted. To recover:

1. Close any process holding the SQLite write lock (the web app,
   any open `<alejandria>` terminal, Electron's main process).
2. **Back up the corrupted file** (move it to a sibling path so
   you can inspect it later if needed):
   ```bash
   mv apps/web/data/library.sqlite apps/web/data/library.sqlite.corrupt
   ```
3. Delete the leftover WAL/SHM files so SQLite doesn't try to
   replay the corrupted journal:
   ```bash
   rm -f apps/web/data/library.sqlite-wal apps/web/data/library.sqlite-shm
   ```
4. Trigger a fresh scan — either via the `scanLocalFolder`
   Server Action on `/` or by re-running the PR1 sidecar CLI:
   ```bash
   python -m alejandria_sidecar extract /path/to/library
   ```
   The new `library.sqlite` is created with the full schema on
   first `openLocalDb`. Any book you re-add gets a fresh
   `content_hash` (the NAS side keeps the originals).

If the corruption recurs on every fresh open, the underlying
disk is likely failing — back up `data/library.sqlite` and the
NAS's `books` table, then replace the storage.

### Scan pipeline

`lib/scan/local-pipeline.ts` exposes `scanFile(path, { spawn })` that
spawns `python -m alejandria_sidecar extract <path>` (the PR1 sidecar),
parses the versioned JSON envelope, and inserts the resulting book
into the local SQLite. The spawn step is injected via
`SidecarSpawnFn` so the pipeline is unit-testable without Python.

### Environment variables

| Var | Default | Used by |
|-----|---------|---------|
| `ALEJANDRIA_DATA_DIR` | `<cwd>/data` | `lib/db/local-db.ts` — location of the single `library.sqlite` file. |
| `ALEJANDRIA_NAS_URL` | `http://localhost:3000` | `lib/api/nas-client.ts` — NAS backend base URL. |

### What's stubbed in PR-3C

- The NAS browse page renders an empty list when the backend is
  unreachable (offline dev). The `try/catch` is intentional so
  the route does not break the build.
- The "Pair with NAS" form displays the device id on success but
  does not yet persist the JWT to a cookie. PR-3E wires
  `cookies()` + redirect.
- The `downloadFromNas` action writes the file to
  `<cwd>/data/books/<id>.bin`. The destination path will move
  to `app.getPath('userData')` once the Electron shell lands.
- The `author` field on locally-persisted NAS rows is a
  placeholder (`author:<id>`) because the NAS detail payload
  only exposes `author_id`. A follow-up PR joins against
  `/api/authors/:id` for the display name.

### Stack details

- Next.js **16.2** with `cacheComponents: true` (Partial
  Prerendering + `'use cache'` directive).
- React **19.2** with Strict Mode.
- TypeScript **5.5** in strict mode (`noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`).
- Vitest **2.1** + Testing Library **16** + jsdom for component
  tests. `vitest.config.ts` aliases `@/*` to the project root so
  the tests can import the same paths the source uses.
- ESLint via `eslint-config-next`.

## ISBN resolution pipeline (PR-4A, issue #71)

`apps/web/lib/isbn-resolver/` ships the 7-layer ISBN
resolution chain mandated by the
`isbn-resolution-pipeline` spec. The pipeline tries
each layer in priority order, stops at the first
checksum-valid hit, and never propagates layer errors
(the chain is supposed to fall through).

| # | Layer | Source | Confidence | Format |
|---|-------|--------|-----------|--------|
| 1 | Embedded metadata (XMP / OPF) | file | 1.0 | PDF, EPUB |
| 2 | Regex over first 50k chars of text | file | 0.9 | any |
| 3 | OpenLibrary search by title + author | API | 0.8 | any |
| 4 | Google Books search by title + author | API | 0.75 / 0.7 | any |
| 5 | Apple Vision OCR on cover | provider | 0.7 | PDF, EPUB |
| 6 | Unlimited-OCR cloud (Baidu) | API | 0.7 | any |
| 7 | National libraries (LoC, BNE, BN Argentina) | API | 0.6 | any |

The orchestrator (`lib/isbn-resolver/resolve.ts`) is
the only place that knows the layer order. It consults
an in-memory cache keyed by
`(title, author, format)` at the start of every call,
short-circuiting the whole chain on a hit. Failures are
NOT cached — the spec's monthly re-attempt needs a
fresh chance to succeed.

### Public surface

```ts
import {
  createIsbnResolver,
  resolve,
  createInMemoryIsbnCache,
  isValidIsbn10,
  isValidIsbn13,
  normalizeIsbn,
} from '@/lib/isbn-resolver'

// Recommended: factory wires the default cache + 7-layer chain.
const resolver = createIsbnResolver()
const meta = await resolver.resolve({
  title: 'Ficciones',
  author: 'Jorge Luis Borges',
  format: 'epub',
  filePath: '/library/borges/ficciones.epub',
})
// meta.isbn === '9788437624747' (from OpenLibrary, layer 3)
// meta.isbnSource === 'openlibrary'

// Direct: pass your own cache and layer overrides.
const cache = createInMemoryIsbnCache()
const meta2 = await resolve(
  { title, author, format, filePath },
  { cache, /* optional layers, fetch, endpoints */ },
)
```

### Layer testability

Every layer is a pure function
`(book, ctx) => Promise<IsbnCandidate | null>` and is
tested in isolation:

- `embedded.ts` — pdfjs-dist for PDF + a dependency-free
  EPUB zip walker for OPF. Mocks the `pdfjs-dist`
  document via `vi.mock`; the EPUB path uses a
  hand-built zip in a real temp file.
- `regex.ts` — pure string helper, no I/O.
- `openlibrary.ts` / `google-books.ts` —
  `ctx.fetch` is injected so tests stay network-free.
- `vision-ocr.ts` / `unlimited-ocr.ts` /
  `national-libraries.ts` — provider seams so the
  Mac-specific Apple Vision / Baidu / national library
  calls are pluggable; the production defaults are
  stubs that return `null` until PR-1 wires the real
  bindings.

### Validation (single source of truth)

`lib/isbn-resolver/validate.ts` is the only module
that knows the ISBN-10 / ISBN-13 check-digit
algorithms. Every layer routes its candidate through
`normalizeIsbn`, which:

- Strips dashes and spaces.
- Uppercases a trailing `x` in ISBN-10.
- Validates the check digit.
- Converts ISBN-10 → ISBN-13 with a recomputed check
  digit (prefix `978`).

The cache and the future `isbn_resolutions` table only
ever see valid ISBN-13s.

### Environment variables

| Var | Used by | Behavior |
|-----|---------|----------|
| `UNLIMITED_OCR_ENDPOINT` | Layer 6 | When unset, layer 6 is skipped silently. |

## iCloud Drive activity sync (PR-4B, issue #73)

`apps/web/lib/sync/` ships the iCloud Drive activity
sync layer that mirrors notes, highlights, bookmarks,
and reading progress across every device the user owns
— without us running a server. The layout is exactly
what Apple Books uses: per-activity JSON files under a
single directory that iCloud propagates automatically.

```
~/Library/Mobile Documents/com~apple~cloudDocs/Alejandria/
├── notes/<bookId>.json
├── highlights/<bookId>.json
├── bookmarks/<bookId>.json
└── progress/<bookId>.json
```

Each file is a self-describing envelope (`version: 1`,
`bookId`, `category`, `updatedAt`, plus the payload).
Two writes racing across devices resolve by
last-write-wins on `updatedAt`, with the OS-level mtime
as a tiebreaker — matching Apple Books's policy rather
than inventing our own.

### Module layout

| File | Responsibility |
|------|----------------|
| `lib/sync/types.ts` | `Note`, `Highlight`, `Bookmark`, `ReadingProgress`, `SyncFile`, `WatcherEvent`, `Watcher`, `SyncFs` |
| `lib/sync/path.ts` | `getICloudDir()` (env-aware), `getSyncFilePath()` |
| `lib/sync/writer.ts` | `writeSyncFile()` — JSON with `version: 1` + `updatedAt` stamp |
| `lib/sync/conflict-resolver.ts` | `resolveSyncConflict()` — LWW with mtime tiebreaker |
| `lib/sync/watcher.ts` | `createWatcher()` — chokidar wrapper, fires `WatcherEvent`s |
| `lib/sync/sync-engine.ts` | `createSyncEngine()` — orchestrates pull / push / merge |
| `lib/sync/engine-factory.ts` | `createDefaultEngine()` — wires the real `node:fs` + chokidar |
| `lib/sync/index.ts` | Public surface |

### Wiring it up (production)

```ts
import { createDefaultEngine } from '@/lib/sync'

const engine = createDefaultEngine() // honours $ALEJANDRIA_ICLOUD_DIR
await engine.start()                  // pull-on-startup
await engine.push({                   // push-on-write
  category: 'notes',
  bookId: bookId,
  data: note,
})
engine.onChange((sf) => {
  // refresh reader UI, etc.
})
```

### Wiring it up (tests)

```ts
import {
  createSyncEngine,
  type ManualWatcher,
  resolveSyncConflict,
} from '@/lib/sync/sync-engine'

const watcher: ManualWatcher = makeManualWatcher()
const engine = createSyncEngine({
  icloudDir: '/tmp/test-alejandria',
  fs: myInMemoryFs,
  watcher,
  decode: (raw) => myValidate(raw),
  resolveConflict: resolveSyncConflict,
})
```

### Environment variables

| Var | Used by | Behavior |
|-----|---------|----------|
| `ALEJANDRIA_ICLOUD_DIR` | `getICloudDir()` | Absolute or relative path; when set, replaces the macOS default. Lets non-macOS dev machines and CI exercise the sync layer against a tmp dir. |

## Observability (PR-3-fix-C, #61)

The web app ships a tiny structured logger, request-ID
propagation, and two health endpoints. Together they let a
debugger trace a single user action from the browser
through the Server Action, the DB write, and the NAS
round-trip.

### Structured logger (`lib/log.ts`)

```ts
import { info, warn, logError } from '@/lib/log'

info('scan', 'file queued', { filePath, sizeBytes })
warn('nas-client', 'slow response', { latencyMs: 1500 })
logError('scan', err, { filePath, stage: 'envelope-parse' })
```

Each call emits a single JSON record to the appropriate
`console.*` sink (`log` for info, `warn` for warn,
`error` for error):

```json
{
  "timestamp": "2026-06-29T12:34:56.789Z",
  "level": "error",
  "scope": "scan",
  "message": "Unexpected token n in JSON at position 0",
  "requestId": "a1b2c3d4e5f6g7h8",
  "context": { "filePath": "/library/rayuela.epub", "stage": "envelope-parse" },
  "error": { "name": "SyntaxError", "message": "...", "stack": "..." }
}
```

In dev / test (`NODE_ENV !== 'production'`) the logger
emits a human-readable single line instead of JSON. The
writer is also injectable via `setWriter` so tests can
capture records without monkey-patching `console`.

### Request-ID propagation (`lib/middleware/request-id.ts` + `proxy.ts`)

Every request runs through the `proxy.ts` root middleware
(which Next.js 16 renamed from `middleware.ts`). The
middleware:

1. Reads the incoming `X-Request-Id` header (or generates a
   fresh 16-hex-char id via `crypto.randomUUID()` when
   absent).
2. Calls `lib/log.setRequestId(id)` so every subsequent
   `info`/`warn`/`logError` call in the request lifetime
   carries the id.
3. Sets `X-Request-Id` on the outgoing response so the
   client can correlate end-to-end.
4. Calls `lib/log.clearRequestId()` after the response so
   the id never leaks to a subsequent request on the same
   worker.

### Catch-block observability

Every catch block in the modules under test calls
`logError(scope, err, { context })` before re-throwing or
returning a structured error:

| Module | Scope | Context |
|--------|-------|---------|
| `lib/scan/local-pipeline.ts` | `scan` | `{stage, filePath}` |
| `lib/api/nas-client.ts` | `nas-client` | `{stage, status\|destPath, path}` |
| `app/_actions/nas-actions.ts` (pair) | `nas-actions.pairDevice` | `{pinLength, code}` |
| `app/_actions/nas-actions.ts` (refresh) | `nas-actions.refreshToken` | `{hasToken, code}` |
| `app/_actions/nas-actions.ts` (download) | `nas-actions.downloadFromNas` | `{bookId, code}` |
| `app/_actions/nas-actions.ts` (scan) | `nas-actions.scanLocalFolder` | `{filePath}` |
| `app/readyz/route.ts` | `readyz` | `{check, stage?}` |

`lib/download/download-flow.ts`, `BookDownloadForm`, and
`PairWithNasForm` have no `try/catch` blocks — they
propagate to the Server Action, which is the single
boundary where observability is enforced.

### `/livez` (liveness)

```
GET /livez → 200 {status: 'ok'}
```

A liveness probe failure means the container orchestrator
should restart this process. Per Kubernetes / RFC
conventions this endpoint MUST NOT depend on external
services (the local SQLite lives at `lib/db/local-db.ts`)
— a liveness failure must not trigger a restart for a
transient DB outage.

### `/readyz` (readiness)

```
GET /readyz → 200 {status: 'ok',    checks: {sqlite: 'ok'}}
GET /readyz → 503 {status: 'degraded', checks: {sqlite: '<error>'}}
```

A readiness failure means the load balancer should stop
sending traffic to this instance; the process itself is
fine. The handler opens the local SQLite, runs
`PRAGMA quick_check` (cheap O(pages) variant of
`integrity_check`), and closes the handle in a `finally`
so we never leak it. A failure is logged via `logError`
with `scope='readyz'` so the operator sees the full
context in the structured log stream.

## See also

- [Design rationale](openspec/changes/alejandria-v2/design.md)
- [Spec — nextjs-app-shell](openspec/changes/alejandria-v2/specs/nextjs-app-shell/spec.md)
- [Spec — library-browse-ui](openspec/changes/alejandria-v2/specs/library-browse-ui/spec.md)
- [Spec — nas-browse-download](openspec/changes/alejandria-v2/specs/nas-browse-download/spec.md)
- [Spec — local-library-db](openspec/changes/alejandria-v2/specs/local-library-db/spec.md)
- [Spec — book-reader](openspec/changes/alejandria-v2/specs/book-reader/spec.md)
- [Spec — pdf-reader](openspec/changes/alejandria-v2/specs/pdf-reader/spec.md)
- [Spec — epub-reader](openspec/changes/alejandria-v2/specs/epub-reader/spec.md)
- [Spec — python-sidecar-cli](openspec/changes/alejandria-v2/specs/python-sidecar-cli/spec.md)
- [Task list](openspec/changes/alejandria-v2/tasks.md)
