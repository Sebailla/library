# alejandria-nas-backend

NestJS application that backs the **alejandria-v2** NAS catalog.

> Part of PR2 of the alejandria-v2 refactor (see
> `openspec/changes/alejandria-v2/tasks.md` Phase 2).
>
> - **PR-2A** — scaffold + docker-compose + `GET /health`
> - **PR-2B** — Postgres schema, pgroonga indexes, idempotent
>   migrations, repository layer (`books`, `categories`, `sagas`,
>   `downloads`)
> - **PR-2C** — `AuthModule`, device pairing
> - **PR-2D** — `BooksModule`, `SearchModule`
> - **PR-2E** — `DownloadsModule`, `WorkersModule` (BullMQ)
> - **PR-2F** — `DiscoveryModule` (mDNS + Tailscale)

## Stack

- **NestJS 10** (Express adapter)
- **TypeScript 5** in strict mode with `@app/*` path alias
- **PostgreSQL 16** with the **pgroonga** extension for Spanish / CJK
  full-text search (BullMQ + workers land in PR-2E)
- **Redis 7** for BullMQ job queue
- **pg** + **ioredis** for driver bindings (no ORM yet — first
  migration ships with PR-2B)
- **Jest 29** + **ts-jest** + **supertest** for end-to-end tests

## Layout

```
services/nas-backend/
├── src/
│   ├── main.ts                # NestJS bootstrap
│   ├── app.module.ts          # root module (DatabaseModule + HealthModule)
│   ├── database/              # PR-2B — Postgres pool + DatabaseModule
│   ├── repositories/          # PR-2B — books, categories, sagas, downloads
│   └── health/
│       ├── health.controller.ts
│       ├── health.module.ts
│       └── health.service.ts
├── migrations/                # PR-2B — 001-009 idempotent SQL files
├── scripts/
│   ├── migrate.ts             # migration runner (library)
│   └── migrate-cli.ts         # migration runner (CLI: `npm run migrate`)
├── test/
│   ├── health.e2e-spec.ts     # supertest contract tests
│   ├── migrations.runner.e2e-spec.ts   # runner + idempotency
│   └── repositories/          # per-repository e2e contract tests
├── Dockerfile                 # multi-stage build
├── docker-compose.yml         # postgres + pgroonga + redis + app
├── package.json
├── tsconfig.json              # strict TS
├── tsconfig.build.json        # build-only excludes test/
├── nest-cli.json
└── jest.config.js
```

## Local development

### Option A — docker compose (recommended)

```bash
cd services/nas-backend
docker compose up --build
# In another terminal:
curl -s http://localhost:3000/health | jq
```

Expected healthy response:

```json
{
  "status": "ok",
  "timestamp": "2026-06-27T12:34:56.789Z",
  "version": "0.1.0"
}
```

When Postgres or Redis are down, the endpoint returns **503** with
per-check status:

```json
{
  "status": "error",
  "timestamp": "2026-06-27T12:34:56.789Z",
  "version": "0.1.0",
  "checks": {
    "db": { "ok": false, "error": "..." },
    "redis": { "ok": true }
  }
}
```

### Option B — npm only (without DB / Redis)

```bash
cd services/nas-backend
npm install
npm run build      # tsc strict, must succeed
npm test           # runs the e2e suite with mocked ping providers
npm run start:dev  # starts the app on :3000; /health will return 503
                   # until postgres + redis are reachable
```

## Tests

The test suite is split into two layers:

1. **Unit / e2e against real Postgres** — the migration runner and
   every repository spec run against a real Postgres + pgroonga
   instance. The connection is read from the `DATABASE_URL`
   environment variable; tests skip when it is not set so the suite
   remains runnable in environments without a database.
2. **In-process controller tests** — the `GET /health` e2e test
   uses `Test.createTestingModule().overrideProvider()` to simulate
   DB and Redis outages; no real network needed.

```bash
npm test                              # runs every suite serially
DATABASE_URL=postgresql://… npm test  # also exercises repo + migration tests
```

Coverage:

| Scenario | Expected |
|----------|----------|
| DB + Redis healthy | `200` `{ status: "ok", timestamp, version }` |
| DB unreachable | `503` `{ status: "error", checks.db.ok = false }` |
| Redis unreachable | `503` `{ status: "error", checks.redis.ok = false }` |
| Migration runner — files listed in lexicographic order | matches `001_…009_*.sql` |
| Migration runner — applied against a fresh schema | all 9 files report `applied` |
| Migration runner — idempotent | second run returns without throwing |
| pgroonga indexes on `books.title` and `books.excerpt` | both `*_pgroonga_idx` exist |
| Bilingual category seed (migration 009) | `/ciencia`, `/arte`, `/literatura` present with `parent_id` wired |
| `BooksRepository` insert + findById | round-trip |
| `BooksRepository` listByAuthor + pagination + search | returns only matching rows |
| `CategoriesRepository` findSubtree | recursive CTE returns root + every descendant |
| `SagasRepository` attachBook + listByAuthor | idempotent attach, per-author filter |
| `DownloadsRepository` insert + markCompleted + listByDevice | ordered by `downloaded_at DESC` |

## Environment variables

| Name | Default | Notes |
|------|---------|-------|
| `PORT` | `3000` | HTTP listener port |
| `DATABASE_URL` | `postgresql://alejandria:alejandria@localhost:5432/alejandria` | pg connection string |
| `REDIS_HOST` | `localhost` | ioredis host |
| `REDIS_PORT` | `6379` | ioredis port |
| `APP_VERSION` | `0.1.0` | overrides the version reported by `/health` |

In docker-compose these are wired to the in-stack service names
(`postgres`, `redis`).

## What's NOT here yet

PR-2B is the data-layer slice. The following land in chained PRs:

- **PR-2C**: `AuthModule`, device pairing
- **PR-2D**: `BooksModule`, `SearchModule` (HTTP routes)
- **PR-2E**: `DownloadsModule`, `WorkersModule` (BullMQ + sidecar spawn)
- **PR-2F**: `DiscoveryModule` (mDNS + Tailscale)

See `openspec/changes/alejandria-v2/tasks.md` Phase 2 for the full list.

## Migrations

Every schema change ships as a numbered, idempotent SQL file under
[`migrations/`](./migrations). The runner in
[`scripts/migrate.ts`](./scripts/migrate.ts) walks the directory in
lexicographic order and applies each file in its own transaction.
Idempotency is enforced by every migration itself — each `CREATE`
uses `IF NOT EXISTS`, every seed insert is guarded by a
`WHERE NOT EXISTS` check on the unique path.

```bash
# Default: read DATABASE_URL from env, run every migration.
DATABASE_URL=postgresql://alejandria:alejandria@localhost:5432/alejandria \
  npm run migrate

# Idempotent: a second run is a no-op.
DATABASE_URL=… npm run migrate
```

Files shipped in PR-2B:

| File | What it does |
|------|--------------|
| `001_extensions.sql` | `CREATE EXTENSION pgroonga, pgcrypto` |
| `002_authors.sql` | `authors` table (BIGSERIAL, unique lastname+firstname) |
| `003_books.sql` | `books` table (BIGSERIAL, FK to authors, content_hash unique) |
| `004_categories.sql` | `categories` (self-referential tree) + `category_aliases` |
| `005_book_categories.sql` | many-to-many bridge with `confidence` + `source` |
| `006_sagas.sql` | `sagas` + `book_sagas` bridge with `ordinal` |
| `007_downloads.sql` | per-device download audit trail |
| `008_pgroonga_indexes.sql` | pgroonga indexes on `books.title`, `books.excerpt` |
| `009_seed_categories.sql` | bilingual taxonomy seed (Ciencia, Arte, Literatura, …) |

## Repositories

The data-access layer is `pg`-backed (no ORM) and lives under
[`src/repositories/`](./src/repositories). Each repository exposes
typed async methods and is unit-tested against a real Postgres +
pgroonga instance.

| Repository | Methods |
|------------|---------|
| `BooksRepository` | `insert`, `findById`, `listByAuthor`, `list`, `search` |
| `CategoriesRepository` | `insert`, `findByPath`, `listChildren`, `findSubtree` (recursive CTE) |
| `SagasRepository` | `insert`, `attachBook` (idempotent), `listByAuthor`, `listBooksInSaga` |
| `DownloadsRepository` | `insert`, `markCompleted`, `listByDevice`, `findById` |
