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
| PR-3A | Next.js 16 scaffold + RSC catalog browse (`apps/web/`) | **This PR** |
| PR-3B | Real local SQLite + FTS5 (`apps/web/lib/db/`) | Pending |
| PR-3C | NAS client with Range-request download (`apps/web/lib/api/`) | Pending |
| PR4 | Electron shell + iCloud Drive + 7-layer ISBN | Pending |

## Running `apps/web/` (PR-3A)

The web app is the Next.js 16 + React 19 shell. It serves the local
library catalog at `/` and the NAS browse shell at `/browse`. Both
routes are React Server Components with the `'use cache'` directive
required by the `nextjs-app-shell` spec.

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
| `npm test` | Vitest one-shot run (component tests under `components/__tests__/`). |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run typecheck` | `tsc --noEmit` against the strict tsconfig. |
| `npm run lint` | `next lint` via `eslint-config-next`. |

### Routes

| Path | Component | Notes |
|------|-----------|-------|
| `/` | `app/(catalog)/page.tsx` | RSC. Reads `lib/db/local-db.ts` (empty list in PR-3A — real SQLite + FTS5 land in PR-3B). Cached for 1h with `cacheTag('local-library')`. |
| `/browse` | `app/(nas)/browse/page.tsx` | RSC. Reads `lib/api/nas-client.ts` (empty list in PR-3A — real fetch + Range-request download land in PR-3C). Cached for 1h with `cacheTag('nas-catalog')`. |

### Environment variables

| Var | Default | Used by |
|-----|---------|---------|
| `ALEJANDRIA_DATA_DIR` | `<cwd>/data` | `lib/db/local-db.ts` — location of the single `db.sqlite` file. PR-3B+ only. |
| `ALEJANDRIA_NAS_URL` | `http://localhost:3000` | `lib/api/nas-client.ts` — NAS backend base URL. |

### What's stubbed in PR-3A

- `lib/db/local-db.ts` returns an empty list; no better-sqlite3
  connection is opened during the scaffold slice.
- `lib/api/nas-client.ts` returns an empty list; no HTTP call is
  made to the NAS.
- The NAS browse page always renders the "Connect to NAS" prompt
  because no device token exists yet (PR-3C adds the PIN pairing
  flow).
- No `packages/core/types/` yet — that ships alongside the real
  `Book`/`Author`/`Category` types in PR-3B.

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
- [Task list](openspec/changes/alejandria-v2/tasks.md)