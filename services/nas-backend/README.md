# alejandria-nas-backend

NestJS application that backs the **alejandria-v2** NAS catalog.

> Part of PR2 of the alejandria-v2 refactor (see
> `openspec/changes/alejandria-v2/tasks.md` Phase 2).
>
> - **PR-2A** — scaffold + docker-compose + `GET /health`
> - **PR-2B** — Postgres schema, pgroonga indexes, idempotent
>   migrations, repository layer (`books`, `categories`, `sagas`,
>   `downloads`)
> - **PR-2C** — `AuthModule`, device pairing, JWT validation,
>   sample protected route (`GET /api/me`)
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
│   ├── app.module.ts          # root module (Database + Health + Auth + Me)
│   ├── database/              # PR-2B — Postgres pool + DatabaseModule
│   ├── repositories/          # PR-2B — books, categories, sagas, downloads
│   ├── auth/                  # PR-2C — AuthModule, JWT, devices repo
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts # POST /api/auth/pair, POST /api/auth/refresh
│   │   ├── auth.service.ts    # PIN validation, JWT mint, SHA-256 token hash
│   │   ├── jwt.strategy.ts    # passport-jwt strategy
│   │   ├── jwt-auth.guard.ts  # Bearer-token guard
│   │   └── devices.repository.ts
│   ├── me/                    # PR-2C — sample protected route
│   │   ├── me.module.ts
│   │   └── me.controller.ts   # GET /api/me
│   └── health/
│       ├── health.controller.ts
│       ├── health.module.ts
│       └── health.service.ts
├── migrations/                # PR-2B + PR-2C — 001-010 idempotent SQL files
├── scripts/
│   ├── migrate.ts             # migration runner (library)
│   └── migrate-cli.ts         # migration runner (CLI: `npm run migrate`)
├── test/
│   ├── health.e2e-spec.ts     # supertest contract tests
│   ├── auth.e2e-spec.ts       # PR-2C — pair + refresh contract
│   ├── me.e2e-spec.ts         # PR-2C — protected route contract
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
| `POST /api/auth/pair` valid PIN | `201` `{token, expires_at, device_id}` (JWT-shaped) |
| `POST /api/auth/pair` invalid PIN | `401` `error.code = BAD_PIN` |
| `POST /api/auth/pair` expired PIN TTL | `401` `error.code = PIN_EXPIRED` |
| `POST /api/auth/pair` persists device row | SHA-256 token_hash stored under returned `device_id` |
| `POST /api/auth/pair` rate-limited (5/min/IP) | 6th attempt within a minute returns `429` `error.code = THROTTLED` |
| `POST /api/auth/refresh` valid token | `201` new token differs from previous |
| `POST /api/auth/refresh` invalidates old token | old token returns `401` on `/api/me` after rotation |
| `POST /api/auth/refresh` rate-limited (10/min/IP) | 11th attempt within a minute returns `429` `error.code = THROTTLED` |
| `GET /api/discovery/info` pre-auth shape | `200` `{ mdns_name, port }` — no IPs leaked |
| `GET /api/discovery/info` rate-limited (60/min/IP) | 61st request within a minute returns `429` `error.code = THROTTLED` |
| `GET /api/discovery/network` no Bearer | `401` `error.code = UNAUTHORIZED` |
| `GET /api/discovery/network` valid Bearer | `200` `{ tailscale_ip, lan_ips }` |
| `ScanProcessor` rejects paths containing `..` | `SidecarError.code = INVALID_PATH`, no spawn |
| `ScanProcessor` rejects absolute paths outside `NAS_LIBRARY_ROOT` | `SidecarError.code = INVALID_PATH`, no spawn |
| `ScanProcessor` rejects paths starting with `-` (argv injection) | `SidecarError.code = INVALID_PATH`, no spawn |
| Auth module — `NAS_JWT_SECRET` unset | boot fails with `Error: NAS_JWT_SECRET is required…` |
| Auth module — `NAS_JWT_SECRET` < 32 bytes | boot fails with `Error: NAS_JWT_SECRET must be at least 32 bytes…` |
| Auth module — `NAS_PAIR_PIN` unset | boot fails with `Error: NAS_PAIR_PIN is required…` |
| Auth module — `NAS_PAIR_PIN` < 8 chars | boot fails with `Error: NAS_PAIR_PIN must be at least 8 characters…` |
| `GET /api/me` no Bearer | `401` `error.code = UNAUTHORIZED` |
| `GET /api/me` valid Bearer | `200` `{device_id, device_name}` |
| `GET /api/me` tampered Bearer | `401` `error.code = TOKEN_INVALID` |
| Migration runner — `010_devices.sql` applied | `devices` table has the documented columns |

## Environment variables

| Name | Required | Default | Notes |
|------|----------|---------|-------|
| `PORT` | no | `3000` | HTTP listener port |
| `DATABASE_URL` | no | `postgresql://alejandria:alejandria@localhost:5432/alejandria` | pg connection string |
| `REDIS_HOST` | no | `localhost` | ioredis host |
| `REDIS_PORT` | no | `6379` | ioredis port |
| `APP_VERSION` | no | `0.1.0` | overrides the version reported by `/health` |
| `NAS_PAIR_PIN` | **yes** | — | Single shared pairing PIN, **≥ 8 characters** (4R review #32). Boot fails when unset or short. |
| `NAS_PIN_TTL_DAYS` | no | `30` | PIN window; `0` or negative ⇒ PIN is treated as expired |
| `NAS_JWT_SECRET` | **yes** | — | HMAC secret for issued JWTs, **≥ 32 bytes** (HS256 security floor). Boot fails when unset or short (4R review #32). |
| `NAS_JWT_TTL_HOURS` | no | `24` | JWT lifetime |
| `NAS_LIBRARY_ROOT` | no | `/share/biblioteca/raw/` | Root every scan job path is resolved against (4R review #33). Paths outside the root are rejected with `INVALID_PATH` before `spawn`. |

In docker-compose these are wired to the in-stack service names
(`postgres`, `redis`). The security env vars ship with
**placeholder values** — replace them with random secrets before
exposing the container to anything but a local developer box:

```bash
openssl rand -base64 48   # → NAS_JWT_SECRET (>= 32 bytes)
openssl rand -base64 16   # → NAS_PAIR_PIN  (>= 8 chars)
```

## What's NOT here yet

PR-2D + PR-2E + PR-2F ship the catalog HTTP slice, the downloads
tracking endpoints, the BullMQ workers that consume the Python
sidecar, and the mDNS + Tailscale discovery module. See
`openspec/changes/alejandria-v2/tasks.md` Phase 2 for the full list.

## Downloads + Workers (PR-2E)

PR-2E adds two related modules that close the loop between the
HTTP layer and the Python sidecar.

### Downloads HTTP surface

```
POST   /api/downloads                { book_id, device_id?, device_name?, user_id?, file_size_bytes? }
                                    → 201 { download_id, resume_supported }

PATCH  /api/downloads/:id            { completed?, bytes_transferred }
                                    → 200 { id, completed, bytes_transferred, book_id, device_id, downloaded_at }

GET    /api/downloads/stats
                                    → 200 { total, completed, top_books: [...], top_devices: [...] }

GET    /api/downloads/by-device/:device_id
                                    → 200 { data: Download[] }
```

`POST /api/downloads` is **idempotent**: if a `(book_id, device_id)`
pair already has a `completed = true` row, the response re-uses the
original `download_id` and returns `resume_supported: true` instead
of creating a duplicate row. The same `(book_id, device_id)` pair
with an in-progress download always creates a NEW row (so the byte
counts do not get clobbered by a reconnect).

All four endpoints sit behind `JwtAuthGuard`. The repository token
(`DOWNLOADS_REPOSITORY`) is exposed as a string so e2e tests stub
it with an in-memory implementation.

### Workers (BullMQ + sidecar)

`WorkersModule` wires two BullMQ workers onto the shared Redis
broker configured by `buildBullMqConnection` (`REDIS_HOST` /
`REDIS_PORT` env vars, default `localhost:6379`):

| Queue        | Processor                | What it does |
|--------------|--------------------------|--------------|
| `scan`       | `ScanProcessor`          | Shells out to `python -m alejandria_sidecar extract <path>` and parses the JSON envelope. |
| `downloads`  | `DownloadsProcessor`     | Updates `bytes_transferred` on a download row (resume bookkeeping, off the Range-request thread). |

`ScanProcessor` is built around a typed `SidecarError` (`code` +
`exitCode` + parsed envelope) so the BullMQ worker can branch on
`FILE_UNREADABLE` vs `BACKEND_UNAVAILABLE` vs `NOT_IMPLEMENTED`
without parsing stderr. Errors are caught and the job is acked so a
corrupt input never halts the queue (per
`nas-scanner-workers` spec § "Errors are isolated, never blocking").

#### Graceful Redis-down behaviour

`WorkersBootstrap.onModuleInit` probes Redis with a 750ms timeout
before starting any worker. If the broker is unreachable the
bootstrap logs a single warning and returns; the rest of the API
keeps serving traffic and `GET /health` reports
`redis: down` for operators. The probe + e2e stubs make the
workers module safe to run in CI and local dev without a live
broker.

## Discovery (PR-2F, hardened PR-2F.1)

PR-2F adds the discovery module so LAN + Tailscale clients can
find the NAS without manual IP / DNS configuration. **PR-2F.1
splits the surface** (4R review #44) so the pre-auth endpoint
never reveals the NAS network-internal layout.

```
GET /api/discovery/info       (pre-auth, open)
  → 200 {
      mdns_name:    'alejandria-nas.local',
      port:         3000
    }
  429: { error: { code: 'THROTTLED', message } }   (60 requests / min / IP)

GET /api/discovery/network    (Bearer required)
  Headers: Authorization: Bearer <jwt>
  → 200 {
      tailscale_ip: '100.64.0.5' | null,
      lan_ips:      ['192.168.1.50', ...]
    }
  401: { error: { code: 'UNAUTHORIZED', message } }
```

| Endpoint         | Auth     | Why this surface |
|------------------|----------|------------------|
| `/info`          | open     | Brand-new clients need the mDNS name + port to even reach the API. |
| `/network`       | Bearer   | LAN + Tailscale IPs reveal the NAS network surface to attackers and are only useful AFTER pairing. |

| Field          | Endpoint       | Source                                                   |
|----------------|----------------|----------------------------------------------------------|
| `mdns_name`    | `/info`        | Bonjour responder published by `MdnsService` (`_alejandria._tcp`). |
| `port`         | `/info`        | `PORT` env var (default 3000).                           |
| `tailscale_ip` | `/network`     | `tailscale ip -4` shelled out by `TailscaleService`; `null` when `tailscale` is missing / `tailscaled` is down. |
| `lan_ips`      | `/network`     | Every non-loopback IPv4 from `os.networkInterfaces()`.  |

### mDNS publish (`MdnsService`)

`MdnsService.onModuleInit` opens a Bonjour responder and
publishes `_alejandria._tcp` on the HTTP port using the host's
first LAN IPv4. The underlying `bonjour` npm package is injected
via the `BONJOUR` string token so e2e tests stub it out — the
test runner never opens a real mDNS responder. Publish errors
(no Avahi / Bonjour on the host) are swallowed so the rest of
the API keeps booting; the discovery endpoint then reports the
LAN IPs as the fallback.

### Tailscale probe (`TailscaleService`)

`TailscaleService.getIp` shells out to `tailscale ip -4` via
`child_process.execFile` (no shell interpreter, fixed command).
The probe returns:

- the trimmed stdout when the CLI exits 0,
- `null` when the binary is missing (exit 127), the daemon is
  down (exit 1), stdout is empty, or the call throws / times out.

The subprocess call is injected via the `TAILSCALE_SHELL`
string token so the unit + e2e suites cover both states without
spawning a real process on the runner.

### Module map addition

| Module            | Controller routes                                        | Services                              | Tokens                                          |
|-------------------|----------------------------------------------------------|---------------------------------------|------------------------------------------------|
| `DiscoveryModule` | `GET /api/discovery/info` (open), `GET /api/discovery/network` (Bearer) | `DiscoveryService`, `MdnsService`, `TailscaleService` | `MDNS_NAME`, `LAN_IPS`, `NAS_HTTP_PORT`, `MDNS_SERVICE_NAME`, `MDNS_SERVICE_PORT`, `MDNS_SERVICE_HOST`, `BONJOUR`, `TAILSCALE_SHELL` |

All tokens are namespaced `NAS_*` so they cannot collide with
anything the other modules inject. The same string-token pattern
is used by `HealthModule` (`DATABASE_PING`, `REDIS_PING`) and
`WorkersModule` (`BULLMQ_CONNECTION`).

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

Files shipped in PR-2B + PR-2C:

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
| `010_devices.sql` | `devices` table — UUID + SHA-256 token hash + INET ip_address |

## Repositories

The data-access layer is `pg`-backed (no ORM) and lives under
[`src/repositories/`](./src/repositories). Each repository exposes
typed async methods and is unit-tested against a real Postgres +
pgroonga instance.

| Repository | Methods |
|------------|---------|
| `AuthorsRepository` | `insert`, `findById`, `list`, `count` |
| `BooksRepository` | `insert`, `findById`, `listByAuthor`, `list` (+filters), `count`, `search` |
| `CategoriesRepository` | `insert`, `findByPath`, `listChildren`, `listRoots`, `listForBook`, `findSubtree` (recursive CTE) |
| `SagasRepository` | `insert`, `attachBook` (idempotent), `listByAuthor`, `listForBook`, `listBooksInSaga` |
| `DownloadsRepository` | `insert`, `markCompleted`, `updateProgress`, `listByDevice`, `findById`, `findCompletedForDeviceAndBook`, `stats` |
| `DevicesRepository` | `insert`, `findByDeviceId`, `updateTokenHash`, `touch` |
| `SearchRepository` | `search` (pgroonga `&@~` + `pgroonga.score(tableoid)`) |

## Auth (PR-2C, hardened PR-2F.1)

The auth module issues a per-device bearer token after a one-time
PIN pairing. Every endpoint other than `GET /health`,
`GET /api/discovery/info`, `POST /api/auth/pair`, and
`POST /api/auth/refresh` requires a valid
`Authorization: Bearer <jwt>` header.

### Endpoints

```
POST /api/auth/pair
  Body:    { pin: "12345678", device_name: "iPad de Seba" }
  201 OK:  { token: "<jwt>", expires_at: "<iso>", device_id: "<uuid>" }
  401:     { error: { code: "BAD_PIN" | "PIN_EXPIRED", message } }
  429:     { error: { code: "THROTTLED", message } }   (5 attempts / min / IP)

POST /api/auth/refresh
  Body:    { token: "<old-jwt>" }
  201 OK:  { token: "<new-jwt>", expires_at: "<iso>", device_id: "<uuid>" }
  401:     { error: { code: "TOKEN_INVALID" | "TOKEN_EXPIRED", message } }
  429:     { error: { code: "THROTTLED", message } }   (10 attempts / min / IP)

GET  /api/me          (sample protected route)
  Headers: Authorization: Bearer <jwt>
  200 OK:  { device_id: "<uuid>", device_name: "iPad de Seba" }
  401:     { error: { code: "UNAUTHORIZED" | "TOKEN_INVALID" | "TOKEN_EXPIRED", message } }
```

### Flow

1. The NAS admin UI shows a PIN (env: `NAS_PAIR_PIN`, no default).
   The PIN is treated as expired when `NAS_PIN_TTL_DAYS <= 0`.
   **Boot fails** when `NAS_PAIR_PIN` is unset or shorter than
   8 characters (4R review #32).
2. The device POSTs the PIN to `/api/auth/pair`. The server mints
   a JWT (HS256, default 24h TTL, env: `NAS_JWT_TTL_HOURS`) with
   claims `{ sub: device_id, jti: random(16 bytes hex) }` and
   inserts a row into `devices` storing the SHA-256 digest of the
   token in `token_hash`. The raw JWT is never persisted.
3. Subsequent calls pass `Authorization: Bearer <jwt>`. The
   `JwtAuthGuard` reads the header, calls
   `AuthService.resolveBearer`, which verifies the signature,
   loads the device row, recomputes SHA-256(token), and compares
   it against the stored hash. A mismatch is treated as
   `TOKEN_INVALID` (revoked).
4. `/api/auth/refresh` accepts a valid token, rotates the stored
   hash atomically, and returns a fresh JWT. The old token
   immediately stops authenticating because its SHA-256 no longer
   matches the stored hash.
5. `last_seen_at` is updated asynchronously on every successful
   authentication (the request does not block on this write).

### Security configuration (4R review #32)

The auth module refuses to start when:

| Variable         | Minimum | Reason |
|------------------|---------|--------|
| `NAS_JWT_SECRET` | 32 bytes (256 bits) | HS256 security floor. Shorter secrets can be brute-forced offline. |
| `NAS_PAIR_PIN`   | 8 characters | Below 8 the PIN space is too small to resist an offline attack at the 5-attempts-per-minute rate limit. |

There are **no fallbacks**. The previous hardcoded defaults
(`dev-secret-change-me`, `0000`) silently weakened production
deploys; they have been removed. The boot-time check is wired
in `src/auth/auth.module.ts` and `src/auth/auth.service.ts`,
exercised by `test/auth.e2e-spec.ts` → `Auth module — boot-time
security validation`.

### Why SHA-256 instead of bcrypt for the token hash

The `token_hash` column stores the SHA-256 hex digest of the raw
JWT — not bcrypt — for one specific reason: bcrypt silently
truncates input to 72 bytes. Two JWTs minted for the same device
in the same second only differ in their `jti` claim, which sits
past the 72-byte mark in the payload. bcrypt would map them to the
same digest and `/api/auth/refresh` would falsely accept the old
token after rotation. SHA-256 has no length limit and the JWT
already carries 256+ bits of entropy from its random `jti`,
so it is safe to store at rest.

## Catalog HTTP routes (PR-2D)

All catalog endpoints require a valid Bearer token. The wire format
is snake_case to match the rest of the API.

```
GET /api/books?page=1&limit=20&author_id=...&format=...&language=...
  Headers: Authorization: Bearer <jwt>
  200 OK:  { data: [BookDto, …], page, limit, total }
  Defaults: page=1, limit=20, max limit=100.

GET /api/books/:id
  Headers: Authorization: Bearer <jwt>
  200 OK:  BookDetailDto
            { id, title, author_id, year, language, format,
              file_path, cover_path, excerpt, indexed_at,
              file_size_bytes, content_hash,
              categories: [{id, path, name_es, name_en}],
              sagas:     [{id, name, author_id}] }
  404:     { error: { code: "NOT_FOUND", message } }

GET /api/authors?page=1&limit=20
  Headers: Authorization: Bearer <jwt>
  200 OK:  { data: [AuthorDto, …], page, limit, total }

GET /api/authors/:id
  Headers: Authorization: Bearer <jwt>
  200 OK:  AuthorDetailDto
            { id, lastname, firstname,
              books: [{id, title, file_path}] }
  404:     { error: { code: "NOT_FOUND", message } }

GET /api/categories
  Headers: Authorization: Bearer <jwt>
  200 OK:  { data: [CategoryDto, …] }
            Each node carries its descendants recursively under
            the ``children`` key. The tree is fetched via the
            ``WITH RECURSIVE`` CTE exposed by
            ``CategoriesRepository.findSubtree``.

GET /api/search?q=...&limit=20&offset=0
  Headers: Authorization: Bearer <jwt>
  200 OK:  { data: SearchHitDto[], query, limit, offset, total }
            Hits are ranked by pgroonga score (descending). Uses
            the ``books_title_pgroonga_idx`` index (migration 008)
            so the query plan stays index-only as the catalog
            grows.
  400:     missing/empty ``q`` → NestJS ValidationPipe default.
```

### Module map

| Module | Controller routes | Service | Repositories |
|--------|-------------------|---------|--------------|
| `BooksModule` | `/api/books`, `/api/books/:id`, `/api/categories` | `BooksService`, `CategoriesService` | `BooksRepository`, `CategoriesRepository`, `SagasRepository` |
| `AuthorsModule` | `/api/authors`, `/api/authors/:id` | `AuthorsService` | `AuthorsRepository`, `BooksRepository` (re-exported) |
| `SearchModule` | `/api/search` | `SearchService` | `SearchRepository` |

Each repository is exposed via a string token
(`BOOKS_REPOSITORY`, `AUTHORS_REPOSITORY`,
`CATEGORIES_REPOSITORY`, `SAGAS_REPOSITORY`, `SEARCH_REPOSITORY`)
so e2e tests can override the implementation with an in-memory
stub via `Test.createTestingModule(...).overrideProvider(...)`.
