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
| PR-3B | Real local SQLite + FTS5 + scan pipeline + PDF reader (`apps/web/`) | **This PR** |
| PR-3C | NAS client with Range-request download (`apps/web/lib/api/`) | Pending |
| PR4 | Electron shell + iCloud Drive + 7-layer ISBN | Pending |

## Running `apps/web/` (PR-3B)

The web app is the Next.js 16 + React 19 shell. It serves the local
library catalog at `/`, the NAS browse shell at `/browse`, and the
new reader at `/reader/[bookId]`. The catalog and NAS browse routes
are React Server Components with the `'use cache'` directive required
by the `nextjs-app-shell` spec; the reader is a Client Component so
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
| `/` | `app/(catalog)/page.tsx` | RSC. Reads `lib/db/local-db.ts` (real `better-sqlite3` + FTS5 in PR-3B). Cached for 1h with `cacheTag('local-library')`. |
| `/browse` | `app/(nas)/browse/page.tsx` | RSC. Reads `lib/api/nas-client.ts` (empty list in PR-3B — real fetch + Range-request download land in PR-3C). Cached for 1h with `cacheTag('nas-catalog')`. |
| `/reader/[bookId]` | `app/reader/[bookId]/page.tsx` | Client Component. Mounts `<Reader />` with `<ProgressBar />` and a lazy-loaded `<PdfViewer />` (`pdfjs-dist` via `next/dynamic({ ssr:false })`). |

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
| `ALEJANDRIA_NAS_URL` | `http://localhost:3000` | `lib/api/nas-client.ts` — NAS backend base URL. PR-3B keeps the empty stub; PR-3C adds real fetch. |

### What's stubbed in PR-3B

- `lib/api/nas-client.ts` returns an empty list; no HTTP call is
  made to the NAS (PR-3C adds the real client).
- The NAS browse page always renders the "Connect to NAS" prompt
  because no device token exists yet (PR-3C adds the PIN pairing
  flow).
- The PDF surface is a placeholder; the real `pdfjs-dist`
  integration (worker source, page render loop, canvas allocation)
  ships in PR-3E.
- The EPUB reader (`epub-reader` spec) ships as a `cfi-wrapper`
  scaffold only; the full implementation follows.

### Stack details

- Next.js **16.2** with `cacheComponents: true` (Partial
  Prerendering + `'use cache'` directive).
- React **19.2** with Strict Mode.
- TypeScript **5.5** in strict mode (`noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noFallthroughCasesInSwitch`).
- Vitest **2.1** + Testing Library **16** + jsdom for component
  tests.
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