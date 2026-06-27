# alejandria-nas-backend

NestJS application that backs the **alejandria-v2** NAS catalog.

> Part of PR2 of the alejandria-v2 refactor (see
> `openspec/changes/alejandria-v2/tasks.md` Phase 2). This PR — **PR-2A** —
> scaffolds the package, the docker-compose stack, and the
> `GET /health` endpoint. Auth, books, search, downloads, workers, and
> discovery modules land in chained follow-up PRs.

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
│   ├── app.module.ts          # root module (wires HealthModule only)
│   └── health/
│       ├── health.controller.ts
│       ├── health.module.ts
│       └── health.service.ts
├── test/
│   └── health.e2e-spec.ts     # supertest contract tests
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

The test suite is self-contained — no real Postgres or Redis needed.
Both ping providers (`DATABASE_PING`, `REDIS_PING`) are injected by
string token so `Test.createTestingModule().overrideProvider()` can
simulate outages.

```bash
npm test
```

Coverage:

| Scenario | Expected |
|----------|----------|
| DB + Redis healthy | `200` `{ status: "ok", timestamp, version }` |
| DB unreachable | `503` `{ status: "error", checks.db.ok = false }` |
| Redis unreachable | `503` `{ status: "error", checks.redis.ok = false }` |

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

PR-2A is the bootstrap slice. The following land in chained PRs:

- **PR-2B**: `DatabaseModule`, `migrations/0001_init.sql` (BIGSERIAL,
  pgroonga indexes, FTS5 trigger ports)
- **PR-2C**: `AuthModule`, device pairing
- **PR-2D**: `BooksModule`, `SearchModule`
- **PR-2E**: `DownloadsModule`, `WorkersModule` (BullMQ + sidecar spawn)
- **PR-2F**: `DiscoveryModule` (mDNS + Tailscale)

See `openspec/changes/alejandria-v2/tasks.md` Phase 2 for the full list.
