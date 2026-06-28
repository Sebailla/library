# biblioteca-v2

Monorepo for the next iteration of the `alejandria` personal-library
project. Lives alongside the legacy MVP at
`../biblioteca/` and replaces it incrementally — the MVP stays
read-only as the reference implementation.

## Layout

```
biblioteca-v2/
├── services/
│   ├── extractors-py/   PR1 — Python sidecar CLI
│   └── nas-backend/     PR2 — NestJS + Postgres + Redis + workers
├── apps/
│   ├── web/             PR3 — Next.js 16 + React 19 App Router
│   └── mac/             PR4 — Electron shell wrapping apps/web
└── packages/
    └── core/types/      Shared TS types mirroring alejandria/core/models.py
```

## PR status

| PR | Slice | Status |
|----|-------|--------|
| PR1 | Python sidecar (`services/extractors-py/`) | Merged |
| PR2 | NAS NestJS backend (`services/nas-backend/`) | Merged |
| PR-3A | Next.js 16 scaffold + RSC catalog browse (`apps/web/`) | Merged |
| PR-3B | Real local SQLite + FTS5 + scan pipeline + PDF reader (`apps/web/`) | Merged |
| PR-3C | NAS client + Range-request download + server actions + pdfjs (`apps/web/`) | **This PR** |
| PR4 | Electron shell + iCloud Drive + 7-layer ISBN | Pending |

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

### Routes

| Path | Component | Notes |
|------|-----------|-------|
| `/` | `app/(catalog)/page.tsx` | RSC. Reads `lib/db/local-db.ts`. Cached for 1h with `cacheTag('local-library')`. Renders a "Pair with NAS" form (PR-3C) so the user can mint a bearer token. |
| `/browse` | `app/(nas)/browse/page.tsx` | RSC. Reads `lib/api/nas-client.ts` via `GET /api/books`. Cached for 1h with `cacheTag('nas-catalog')`. Renders an empty list when the NAS is offline. |
| `/reader/[bookId]` | `app/reader/[bookId]/page.tsx` | Client Component. Mounts `<Reader />` with `<ProgressBar />` and a lazy-loaded `<PdfViewer />` (`pdfjs-dist` via `next/dynamic({ ssr:false })`). |

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
| `openLocalDb()` | Opens (or creates) the DB and returns the helper object. |
| `db.insertBook(input)` | Insert one book. Throws on duplicate `id` / `content_hash`. |
| `db.findById(id)` | Fetch one book by id, or `null` if missing. |
| `db.listBooks()` | List all books in newest-first `rowid` order. |
| `db.searchBooks(query)` | FTS5 prefix-match search over `title` + `excerpt`. |
| `db.insertProgress(bookId, page, pct)` | Upsert reading progress. |
| `db.getProgress(bookId)` | Fetch reading progress, or `null` if missing. |

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
