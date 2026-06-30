# alejandria-nas-backend

NestJS application that backs the **alejandria-v2** NAS catalog.

> Part of PR2 of the alejandria-v2 refactor (see
> `openspec/changes/alejandria-v2/tasks.md` Phase 2).
>
> - **PR-2A** — scaffold + docker-compose + `GET /health`
> - **PR-2G** — resilience (BullMQ retry cap, mDNS error listener,
>   `schema_migrations` table, `/livez` + `/readyz` split,
>   scan-processor timeout + buffer cap)
> - **PR-2G.1** — correctness + readability blockers from the 4R
>   review: search query has `@MaxLength(256)` + regex whitelist
>   (#39), `HealthModule` shares `DatabaseModule`'s `PG_POOL`
>   instead of opening a parallel pool (#40), global `ValidationPipe`
>   returns the project envelope `#41`), `/api/downloads` no longer
>   trusts body fields for attribution (POST derives from bearer,
>   PATCH enforces `row.device_id === bearer`, `/by-device/:id`
>   enforces path-vs-bearer match — #42), nightly `pg_cron` job
>   defragmenting the pgroonga indexes at 03:00 UTC (#43)
> - **PR-2B** — Postgres schema, pgroonga indexes, idempotent
>   migrations, repository layer (`books`, `categories`, `sagas`,
>   `downloads`)
> - **PR-2C** — `AuthModule`, device pairing, JWT validation,
>   sample protected route (`GET /api/me`)
> - **PR-2D** — `BooksModule`, `SearchModule`
> - **PR-2E** — `DownloadsModule`, `WorkersModule` (BullMQ)
> - **PR-2F** — `DiscoveryModule` (mDNS + Tailscale)
> - **PR-N1** — `FilesModule` (`GET /api/files/:id` with HTTP Range,
>   `HEAD /api/files/:id` for resumable downloads)
> - **PR-N2** — `LibrariesModule` (`/api/libraries/*` CRUD + per-device
>   active library, `books.library_id` scoping on the catalog queries)
> - **PR-N3** — Download tracking enhancements: `devices.is_admin`
>   (migration 015) + admin gate on `/api/downloads/stats` and
>   `/api/downloads/by-book/:book_id` (403 `ADMIN_REQUIRED`), plus
>   `GET /api/me/downloads` (caller-scoped) and the privacy check
>   on `/api/downloads/by-device/:device_id` (path-vs-bearer match).
> - **PR-N4** — `ScanModule` (`/api/admin/scan/*` admin-only full /
>   incremental scan enqueue + status list + cooperative cancel +
>   SSE progress streaming). `scan_jobs` table (migration 016) is
>   the durable record; a BullMQ worker (`admin-scan` queue) walks
>   `library.root_path` cooperatively, observing the `cancelled`
>   flag between files.

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
│   ├── app.module.ts          # root module (Database + Health + Auth + Me + Books + Files + Libraries + ...)
│   ├── database/              # PR-2B — Postgres pool + DatabaseModule
│   ├── repositories/          # PR-2B + PR-N2 — books, categories, sagas, downloads
│   ├── auth/                  # PR-2C — AuthModule, JWT, devices repo
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts # POST /api/auth/pair, POST /api/auth/refresh
│   │   ├── auth.service.ts    # PIN validation, JWT mint, SHA-256 token hash
│   │   ├── jwt.strategy.ts    # passport-jwt strategy
│   │   ├── jwt-auth.guard.ts  # Bearer-token guard
│   │   └── devices.repository.ts
│   ├── me/                    # PR-2C + PR-N3 — caller-scoped routes
│   │   ├── me.module.ts
│   │   └── me.controller.ts   # GET /api/me, GET /api/me/downloads (PR-N3)
│   ├── files/                 # PR-N1 — Range-aware file streaming
│   │   ├── files.module.ts    # wires FilesService + LIBRARY_ROOT token
│   │   ├── files.controller.ts # GET/HEAD /api/files/:book_id
│   │   ├── files.service.ts   # parseRangeHeader, resolveBookFilePath,
│   │   │                       # streamFile
│   │   └── files.types.ts     # RangeSpec, RangeParseError, FORMAT_TO_MIME
│   ├── libraries/             # PR-N2 — multi-library registry
│   │   ├── libraries.module.ts   # wires controller + service + repository
│   │   ├── libraries.controller.ts # GET/POST /api/libraries, GET/PATCH/DELETE /:id, PUT /:id/active
│   │   ├── libraries.service.ts   # creator-only authz + LIBRARY_NOT_EMPTY
│   │   ├── libraries.repository.ts # PgLibrariesRepository + LIBRARIES_REPOSITORY token
│   │   ├── libraries.adapters.ts # PgLibraryBookCountAdapter, PgDeviceLookupAdapter
│   │   └── libraries.types.ts  # Library, NewLibrary, LibraryPatch, DeviceLibrary
│   ├── admin/                   # PR-N4 — admin-only HTTP surfaces
│   │   └── scan/                #   PR-N4 admin scan (enqueue, status, cancel, SSE)
│   │       ├── scan.module.ts       # wires controller + service + repository + event bus + BullMQ producer
│   │       ├── scan.controller.ts   # POST/GET /api/admin/scan/* + SSE
│   │       ├── scan.service.ts      # enqueue + cancel orchestration
│   │       ├── scan.repository.ts   # PgScanRepository + SCAN_REPOSITORY token
│   │       ├── scan-admin.guard.ts  # JwtAuthGuard + DEVICES_REPOSITORY.is_admin check
│   │       ├── scan-event-bus.ts    # per-jobId EventEmitter wrapper for SSE fan-out
│   │       └── scan.types.ts        # ScanJob, ScanJobKind, ScanJobStatus, ScanProgressEvent, NewScanJob
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
│   ├── files.e2e-spec.ts      # PR-N1 — GET/HEAD /api/files Range contract
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
curl -s http://localhost:3000/livez | jq
curl -s http://localhost:3000/readyz | jq
```

Expected healthy response (`/health`):

```json
{
  "status": "ok",
  "timestamp": "2026-06-27T12:34:56.789Z",
  "version": "0.1.0"
}
```

When Postgres or Redis are down, `/health` returns **503** with
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

`/livez` always returns **200** (liveness ignores dependencies).
`/readyz` returns **200** when Postgres is reachable; Redis-down
stays **200** because the HTTP layer is fully functional on
Postgres alone. `/readyz` returns **503** only when Postgres is
unreachable.

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
| `/livez` always returns 200 | liveness ignores dependencies |
| `/readyz` Postgres-only check | 200 when DB up, 503 when DB down |
| Migration runner — files listed in lexicographic order | matches `001_…009_*.sql` |
| Migration runner — applied against a fresh schema | all 9 files report `applied` |
| Migration runner — idempotent | second run returns without throwing |
| Migration runner — `schema_migrations` table records every applied file | rows for every `.sql` |
| Migration runner — re-run skips already-applied files | zero new rows on second run |
| pgroonga indexes on `books.title` and `books.excerpt` | both `*_pgroonga_idx` exist |
| Bilingual category seed (migration 009) | `/ciencia`, `/arte`, `/literatura` present with `parent_id` wired |
| `BooksRepository` insert + findById | round-trip |
| `BooksRepository` listByAuthor + pagination + search | returns only matching rows |
| `BooksRepository` list / count with `libraryId` filter | narrows to a single library |
| `LibrariesRepository` insert / findById / list / update / delete | round-trip every CRUD method |
| `LibrariesRepository` setActiveForDevice + getActiveForDevice | at most one active library per device |
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
| Migration runner — `012-014` applied | `libraries` + `device_libraries` + `books.library_id` exist with the documented shape |
| `GET /api/libraries` no Bearer | `401` `error.code = UNAUTHORIZED` |
| `GET /api/libraries` valid Bearer | `200` `[]` when empty, snake_case DTOs when populated |
| `POST /api/libraries` valid Bearer | `201` LibraryDto with `created_by_device_id` stamped |
| `POST /api/libraries` empty `name` | `400` from global ValidationPipe |
| `GET /api/libraries/:id` missing | `404` `error.code = NOT_FOUND` |
| `PATCH /api/libraries/:id` not the creator | `403` `error.code = FORBIDDEN` |
| `PATCH /api/libraries/:id` empty body | `404` `error.code = EMPTY_PATCH` |
| `DELETE /api/libraries/:id` not the creator | `403` `error.code = FORBIDDEN` |
| `DELETE /api/libraries/:id` books still indexed | `409` `error.code = LIBRARY_NOT_EMPTY` |
| `DELETE /api/libraries/:id` empty + creator | `204` and the row vanishes |
| `PUT /api/libraries/:id/active` missing | `404` `error.code = NOT_FOUND` |

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

PR-2D + PR-2E + PR-2F + PR-N1 + PR-N2 ship the catalog HTTP
slice, the downloads tracking endpoints, the BullMQ workers
that consume the Python sidecar, the mDNS + Tailscale
discovery module, the Range-aware files streaming endpoint,
and the multi-library registry. See
`openspec/changes/alejandria-v2/tasks.md` Phase 2 for the full
list.

## Downloads + Workers (PR-2E)

PR-2E adds two related modules that close the loop between the
HTTP layer and the Python sidecar.

### Downloads HTTP surface

```
POST   /api/downloads                { book_id, device_id?, device_name?, user_id?, file_size_bytes? }
                                    → 201 { download_id, resume_supported }
                                    (admin: not required)

PATCH  /api/downloads/:id            { completed?, bytes_transferred }
                                    → 200 { id, completed, bytes_transferred, book_id, device_id, downloaded_at }
                                    (admin: not required)

GET    /api/downloads/stats
                                    → 200 { total, completed, top_books: [...], top_devices: [...] }
                                    (admin: REQUIRED)

GET    /api/downloads/by-book/:book_id
                                    → 200 { book_id, top_devices: [{device_id, device_name, count, last_downloaded_at}] }
                                    (admin: REQUIRED)

GET    /api/downloads/by-device/:device_id
                                    → 200 { data: Download[] }
                                    (admin: not required; privacy check — path param MUST match bearer)

GET    /api/me/downloads            (PR-N3)
                                    → 200 { data: Download[] }
                                    (admin: not required; caller-scoped via JWT)
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

#### Admin gate (PR-N3)

`GET /api/downloads/stats` and `GET /api/downloads/by-book/:book_id`
require `device.is_admin = true` (migration 015). A non-admin
bearer gets:

```json
403 { "error": { "code": "ADMIN_REQUIRED", "message": "admin role required" } }
```

The check fires on identity resolution: every request reads
`req.device.deviceId` from the `JwtAuthGuard`, looks up the row in
`DevicesRepository.isAdmin`, and refuses with the same envelope on
mismatch. The other endpoints (POST, PATCH, `/by-device/:id`,
`/me/downloads`) are open to every paired device; the privacy
check on `/by-device/:id` is the bearer-vs-path-param comparison
4R #42 introduced, and `/me/downloads` resolves `device_id`
server-side exclusively.

#### Privacy boundary (PR-N3)

`GET /api/downloads/by-device/:device_id` enforces that the path
param equals the bearer's `deviceId` — otherwise:

```json
403 { "error": { "code": "FORBIDDEN", "message": "Bearer device does not match path param" } }
```

`GET /api/me/downloads` is the caller-scoped alternative: there
is no client-controlled identifier on the wire, so a paired but
unprivileged device cannot ask for another device's history by
passing a different `device_id`. The repository method
`listForDevice` is the privacy boundary; the controller does not
trust any user input beyond the JWT-derived identity.

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

#### Retry budget (4R review #35)

Both workers share the same defaults from `buildQueueOptions()`:

- `attempts: 3` with exponential 5s backoff (transient spawn
  failures get a retry; corrupt input does not).
- `removeOnComplete: { age: 3600, count: 1000 }` (trim completed
  jobs after 1h or 1000 entries).
- `removeOnFail: { age: 86400 }` (keep failed jobs for 24h so an
  operator can inspect).

The processor is wrapped in `makeResilientProcessor()` so a
`SidecarError` (corrupt input — `FILE_UNREADABLE`,
`INVALID_PATH`, etc.) becomes `UnrecoverableError` and BullMQ
skips remaining retries. Transient errors (Redis blip, spawn
ENOMEM) are rethrown unchanged so BullMQ's normal retry loop
applies.

#### Spawn safety (4R review #45)

`ScanProcessor.runExtract` enforces two walls around the
`python -m alejandria_sidecar extract <path>` spawn:

- `MAX_OUTPUT_BYTES = 64 MB` per stream (stdout AND stderr).
  On overflow the child is SIGKILL'd and the rejection is
  translated to `UnrecoverableError` with `SidecarError.code =
  OUTPUT_OVERFLOW`. A misbehaving sidecar cannot OOM the worker.
- `SPAWN_TIMEOUT_MS = 60 s` wall-clock. On timeout the child is
  SIGKILL'd and the rejection is `UnrecoverableError` with
  `SidecarError.code = SPAWN_TIMEOUT`. A hung Python interpreter
  cannot block the queue forever.

Both limits are exposed as constants and constructor options
(`maxOutputBytes`, `spawnTimeoutMs`) so tests can lower them
without allocating 64 MB / waiting 60 s.

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

**Avahi / Bonjour requirement.** The `bonjour` npm package
emits `'error'` asynchronously when UDP bind fails (EADDRINUSE
on 5353, EACCES without Avahi, etc.). `MdnsService` attaches
an `'error'` listener at construction time (4R review #36) so
the expected steady state on a QNAP container without Avahi /
Bonjour is a logged warning, not a process crash. To enable
mDNS discovery on a Linux host, install **Avahi**:

```bash
sudo apt-get install avahi-daemon avahi-utils   # Debian / Ubuntu
sudo systemctl enable --now avahi-daemon
```

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

## Files (PR-N1)

PR-N1 closes the NAS backend by exposing the book files behind a
Range-aware HTTP endpoint so the desktop / mobile / web clients
can resume partial downloads without re-fetching the entire
archive.

```
GET  /api/files/:book_id   (Bearer required, Range optional)
  Headers: Authorization: Bearer <jwt>
           Range: bytes=0-1023  (optional — resumable downloads)
           If-None-Match: "<etag>"   (optional — 304 short-circuit)
  → 200 { body }                       full file
  → 206 { body }                       partial content (Range)
  → 304                                 not modified
  → 404 { error: { code: 'FILE_NOT_FOUND' } }
  → 416 { error: ..., Content-Range: bytes */<size> }
  → 500 { error: { code: 'FILE_READ_ERROR' } }

HEAD /api/files/:book_id   (Bearer required)
  Headers: Authorization: Bearer <jwt>
  → 200 (Content-Length, Content-Type, Accept-Ranges: bytes, ETag)
```

Every response carries `Accept-Ranges: bytes`, `ETag: "<hex-size>-<hex-mtime>"`,
and `Last-Modified` so the client can resume, re-validate, or
preload metadata in parallel with the download itself.

### Path safety (4R review principle)

`FilesService.resolveBookFilePath` rejects any stored path that
escapes the configured library root (`NAS_LIBRARY_ROOT`, default
`/share/biblioteca/raw/`) — including `..` traversal attempts and
absolute paths that resolve outside the root. The check uses
`path.resolve` so the prefix comparison is reliable across POSIX
and Windows-style separators, and the failure surfaces as
`404 FILE_NOT_FOUND` (intentionally vague so the configured root
is not leaked).

### Range parsing

`FilesService.parseRangeHeader` accepts the byte-range subset of
RFC 9110 §14.1.2:

| Form                | Meaning                  |
|---------------------|--------------------------|
| `bytes=N-M`         | closed range             |
| `bytes=N-`          | from N to EOF            |
| `bytes=-N`          | last N bytes             |
| multi-range         | NOT supported — 200 full |
| syntactically broken | NOT a Range — 200 full   |
| start ≥ fileSize    | 416 with `bytes */<size>`|

### Module map addition

| Module       | Controller routes                                       | Services        | Tokens                  |
|--------------|---------------------------------------------------------|-----------------|-------------------------|
| `FilesModule` | `GET /api/files/:book_id`, `HEAD /api/files/:book_id`   | `FilesService`  | `LIBRARY_ROOT`          |

`FilesModule` imports `AuthModule` (for `JwtAuthGuard`) and
`BooksModule` (for the re-exported `BOOKS_REPOSITORY` string
token). The module is read-only against the books table — it
looks up `books.file_path` and streams from disk; it never
mutates a book row.

## Libraries (PR-N2)

PR-N2 closes the multi-library registry gap: the NAS now owns
a `libraries` table that every book row can be scoped to, and
each paired device picks one of the available libraries as
its active browsing target. The HTTP surface is CRUD over
`/api/libraries/*`; the per-device activation flag is
stored in the `device_libraries` join table.

```
GET    /api/libraries               (Bearer required)
  → 200 [LibraryDto, …]            ordered by id ASC
  401:  { error: { code: 'UNAUTHORIZED' } }

POST   /api/libraries               (Bearer required)
  Body: { name: string, root_path: string }
  → 201 LibraryDto
  400:  empty/missing fields (global ValidationPipe)
  401:  { error: { code: 'UNAUTHORIZED' } }

GET    /api/libraries/:id           (Bearer required)
  → 200 LibraryDto
  404:  { error: { code: 'NOT_FOUND', message: 'Library not found' } }

PATCH  /api/libraries/:id           (Bearer required)
  Body: { name?: string, root_path?: string }   (at least one field)
  → 200 LibraryDto
  403:  caller is not the creator → { error: { code: 'FORBIDDEN', … } }
  404:  { error: { code: 'NOT_FOUND' } }     row missing
  404:  { error: { code: 'EMPTY_PATCH' } }   body has no fields

DELETE /api/libraries/:id           (Bearer required)
  → 204
  403:  { error: { code: 'FORBIDDEN', … } }   caller is not the creator
  404:  { error: { code: 'NOT_FOUND' } }      row missing
  409:  { error: { code: 'LIBRARY_NOT_EMPTY', … } }   books still indexed

PUT    /api/libraries/:id/active    (Bearer required)
  → 200 LibraryDto
  404:  { error: { code: 'NOT_FOUND' } }      row missing
```

The wire DTO is snake_case to match the rest of the API:

```jsonc
{
  "id": 1,
  "name": "Borges, Jorge Luis",
  "root_path": "/share/biblioteca/raw/borges",
  "created_by_device_id": "f2a3…",   // null for admin-imported rows
  "created_at": "2026-06-29T22:45:00.000Z"
}
```

### Authorisation model

- **CREATE** is open to every paired device. The new row is
  stamped with the caller's `device_id` so PATCH/DELETE can
  match it later. There is no "library admin" role in this
  slice — admin overrides (e.g. a SQL import) set
  `created_by_device_id = NULL`, and only operators with DB
  access can mutate those rows.
- **PATCH** and **DELETE** are creator-only. The service
  throws `ForbiddenException` (HTTP 403) when
  `library.created_by_device_id !== req.device.deviceId`.
- **DELETE** is refused with 409 `LIBRARY_NOT_EMPTY` when the
  `books.library_id` count for that row is > 0. The defence
  keeps the `books.library_id` FK (migration 014) from
  dangling when an admin drops a library that still indexes
  books.
- **PUT /:id/active** is open to every paired device and is
  idempotent. The repository flips every other `device_libraries`
  row for the same device to `active = FALSE` in the same
  transaction so at most one row per device is active.

### Module map addition

| Module           | Controller routes                                                  | Service           | Repositories + Adapters                                                                  |
|------------------|--------------------------------------------------------------------|-------------------|------------------------------------------------------------------------------------------|
| `LibrariesModule`| `GET/POST /api/libraries`, `GET/PATCH/DELETE /api/libraries/:id`, `PUT /api/libraries/:id/active` | `LibrariesService` | `LIBRARIES_REPOSITORY` (PgLibrariesRepository), `LIBRARY_BOOK_COUNT` (PgLibraryBookCountAdapter over `BOOKS_REPOSITORY.countByLibrary`), `DEVICES_LOOKUP` (PgDeviceLookupAdapter over `DEVICES_REPOSITORY.findByDeviceId`) |

`LibrariesModule` imports `AuthModule` (for `JwtAuthGuard`),
`DatabaseModule` (for `PG_POOL`), and `BooksModule` (for the
`BOOKS_REPOSITORY` provider the `countByLibrary` adapter
needs). The same string-token pattern as `BooksModule` makes
the controller e2e suite stub all three seams with in-memory
implementations.

### Schema (PR-N2)

| Migration                    | What it adds                                                                                          |
|------------------------------|-------------------------------------------------------------------------------------------------------|
| `012_libraries.sql`          | `libraries` table — `BIGSERIAL id`, `name`, `root_path`, `created_by_device_id UUID NULL`, `created_at`. Index on `created_by_device_id` (partial, `WHERE NOT NULL`). |
| `013_device_libraries.sql`   | `device_libraries(device_id UUID, library_id BIGINT REFERENCES libraries(id) ON DELETE CASCADE, active BOOLEAN)` with composite PK + partial index on `(device_id, active)`. |
| `014_books_library_id.sql`   | `ALTER TABLE books ADD COLUMN library_id BIGINT REFERENCES libraries(id)` + B-tree index. Column is NULLABLE so the MVP import path can land books before library resolution is known. |

## Admin scan (PR-N4)

PR-N4 closes the admin-driven scan surface: before this PR the
only way to trigger a scan was via the filesystem watcher
(PR-2E). Operators could not force a full rescan, request an
incremental scan on a specific library, observe progress
without tailing BullMQ, or cancel a running scan.

The `scan_jobs` table (migration 016) is the durable record of
every admin scan request. The HTTP layer (`/api/admin/scan/*`)
is gated by `JwtAuthGuard` + `ScanAdminGuard` — every endpoint
returns `403 ADMIN_REQUIRED` for a paired (but unprivileged)
device. The BullMQ worker (`admin-scan` queue) walks
`library.root_path` cooperatively, observing the `cancelled`
flag between files; the SSE endpoint multiplexes the
`ScanEventBus` so the iPad client gets a per-job progress
channel.

### Endpoints

| Method | Path                                  | Auth      | Status | Body                                        |
|--------|---------------------------------------|-----------|--------|---------------------------------------------|
| POST   | `/api/admin/scan/full`                | admin     | 202    | `{}` (no library_id → whole-NAS scan)       |
| POST   | `/api/admin/scan/incremental`         | admin     | 202    | `{ "library_id": <int> }` (required)        |
| GET    | `/api/admin/scan/status`              | admin     | 200    | `{ jobs: ScanJobDto[] }` (newest first)     |
| GET    | `/api/admin/scan/status/:job_id`      | admin     | 200/404| `{ job: ScanJobDto }` or 404 NOT_FOUND      |
| POST   | `/api/admin/scan/cancel/:job_id`      | admin     | 200    | `{ cancelled: bool }` (true / false)        |
| GET    | `/api/admin/scan/events/:job_id`      | admin     | 200/404| SSE stream of `ScanProgressEvent` objects   |

Every non-`events` endpoint returns `{ job_id }` (or the
appropriate response body) on success. Non-admin bearers get
`{ error: { code: "ADMIN_REQUIRED", message: "admin role required" } }`
with HTTP 403. Missing or invalid Bearer tokens get
`{ error: { code: "UNAUTHORIZED", message: "..." } }` with HTTP 401.

### Wire shapes

**`ScanJobDto`** (returned by `GET /status` and `GET /status/:id`):

```jsonc
{
  "id": "11111111-1111-1111-1111-111111111111",
  "library_id": 7,                  // null for whole-NAS scans
  "kind": "full",                   // "full" | "incremental"
  "status": "running",              // queued | running | done | cancelled | failed
  "started_at": "2026-06-29T12:00:00Z",
  "finished_at": null,
  "total_files": 1024,
  "processed_files": 256,
  "cancelled": false,
  "error": null                     // populated when status == "failed"
}
```

**`ScanProgressEvent`** (SSE `data:` payload):

```jsonc
{
  "jobId": "11111111-1111-1111-1111-111111111111",
  "type": "progress",               // progress | done | cancelled | failed
  "processed": 256,
  "total": 1024,                    // null until the worker finishes walking
  "error": "...",                   // only on "failed"
  "timestamp": "2026-06-29T12:00:01Z"
}
```

The SSE stream sends each event as two lines:

```
event: progress
data: {"jobId":"...","type":"progress","processed":256,"total":1024,"timestamp":"..."}

```

In addition to event frames, the server emits a comment-only
frame every 25 seconds:

```
:keepalive

```

The comment line is the SSE wire format's way of carrying
metadata that the client must ignore (`EventSource` consumers
do not surface it). It exists so reverse proxies (nginx,
Cloudflare) do not buffer / close an idle long-running scan
stream — a typical `proxy_read_timeout` is 60 seconds. The
cadence is controlled by the `SSE_HEARTBEAT_INTERVAL_MS`
provider (default 25_000 ms).

The server closes the response when:
1. The client disconnects (`res.on('close')`),
2. The job reaches a terminal status — the bus delivers the
   matching event and we `res.end()`, or
3. The initial row lookup fails (`404 NOT_FOUND`).

For a job that is already terminal when a client connects, the
controller synthesises the final event from the row so late
subscribers still get a single deterministic event.

#### SSE contract (issue #100)

The SSE endpoint's behaviour is contract-bound for the iPad
admin UI. The four invariants are:

1. **Terminal-state replay.** A client that connects against
   a job already in `done` / `cancelled` / `failed` receives
   exactly one synthetic terminal frame derived from the row,
   then the server closes the stream. The client does not
   need a separate `GET /status/:id` poll to know the final
   state — the SSE endpoint is enough.
2. **No historical replay.** The bus has no replay log. A
   subscriber that joins after the worker publishes a
   `progress` event MUST NOT see past ticks — the bus is the
   live channel, not the audit trail. Operators that need
   the historical view read the `scan_jobs` row directly via
   `GET /api/admin/scan/status/:id`.
3. **Live progress fan-out.** While the job is `running`, the
   controller subscribes the open response to the bus. Every
   `progress` event the worker publishes is delivered as an
   `event: progress\ndata: <json>\n\n` frame.
4. **Close on terminal event.** When the worker delivers a
   `done` / `cancelled` / `failed` event on a live stream,
   the controller writes the matching frame and closes the
   response. Clients do not have to rely on their own idle
   timeout to discover that the scan finished. The 25-second
   heartbeat interval is cancelled at the same time so the
   Node event loop does not keep the server alive past the
   close.

Together these guarantee that a fresh `EventSource` either
receives the terminal event (job already finished) or follows
the live channel until it ends with a terminal event. Either
way the client only needs one HTTP connection to learn the
final state.

### Cooperative cancellation

The worker checks the `cancelled` flag between files. The
controller flips the flag via `POST /api/admin/scan/cancel/
:job_id`; the worker observes it on the next iteration and
transitions to `cancelled` without touching any further file.
A cancel request against a job already in a terminal status
(`done` / `failed` / `cancelled`) returns `{ cancelled:
false }` — flipping the flag after the worker has finished
would race with the worker's own bookkeeping.

### Migrations

| Migration                    | What it adds                                                                                          |
|------------------------------|-------------------------------------------------------------------------------------------------------|
| `016_admin_scan_jobs.sql`    | `scan_jobs(id UUID PK, library_id BIGINT REFERENCES libraries(id) NULL, kind CHECK ('full','incremental'), status CHECK ('queued','running','done','cancelled','failed'), started_at / finished_at TIMESTAMPTZ, total_files INT, processed_files INT DEFAULT 0, cancelled BOOLEAN DEFAULT FALSE, error TEXT)`. Indexes on `status` (admin list endpoint, worker pickup loop) and `library_id` (per-library history view). |

## Migrations

Every schema change ships as a numbered SQL file under
[`migrations/`](./migrations). The runner in
[`scripts/migrate.ts`](./scripts/migrate.ts) walks the directory
in lexicographic order and applies each file in its own
transaction. The runner owns a `schema_migrations` table
(filename PK, applied_at timestamptz) that records every
applied file (4R review #37). On every run the table is created
if missing (`CREATE TABLE IF NOT EXISTS`); already-applied
files short-circuit and are reported under `skipped`. Newly-
applied files are inserted into `schema_migrations` AND executed
inside the SAME transaction, so a partial failure rolls back the
row too — the operator can fix + retry and the previously-failed
file is re-applied.

```bash
# Default: read DATABASE_URL from env, run every migration.
DATABASE_URL=postgresql://alejandria:alejandria@localhost:5432/alejandria \
  npm run migrate

# Re-run: every previously-applied file is skipped, zero new
# schema_migrations rows are inserted.
DATABASE_URL=… npm run migrate
```

### Probe endpoints for k8s / load balancers

| Endpoint  | Wire to       | 200 when                                | 503 when         |
|-----------|---------------|-----------------------------------------|------------------|
| `/livez`  | `livenessProbe`  | process is up                       | never            |
| `/readyz` | `readinessProbe` | Postgres reachable (Redis-down OK) | Postgres down    |
| `/health` | operator curl    | Postgres + Redis both reachable      | either down      |

Files shipped in PR-2B + PR-2C + PR-N2:

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
| `011_pgroonga_defrag.sql` | `pgroonga_index_defrag(text)` helper + nightly pg_cron job at 03:00 UTC (4R review #43) |
| `012_libraries.sql` | `libraries` table — BIGSERIAL id + name + root_path + created_by_device_id (UUID NULL) + created_at |
| `013_device_libraries.sql` | `device_libraries` join — composite PK + ON DELETE CASCADE + partial index on `(device_id, active)` |
| `014_books_library_id.sql` | `books.library_id` (nullable FK to libraries) + B-tree index |
| `015_devices_is_admin.sql` | `devices.is_admin BOOLEAN DEFAULT FALSE NOT NULL` — admin gate for `/api/downloads/stats` + `/api/downloads/by-book/:book_id` (PR-N3) |

### pgroonga ops runbook (4R review #43)

Migration 011 installs a PL/pgSQL helper that wraps
`pgroonga_command('defrag', …)` and schedules a nightly pg_cron
job at **03:00 UTC** that defrags both `books_title_pgroonga_idx`
and `books_excerpt_pgroonga_idx`.

#### Why defrag?

pgroonga stores its inverted index on disk as a series of
segments. Heavy INSERT/UPDATE traffic on the `books` table
eventually fragments those segments, which slows down queries.
The standard mitigation is to run `pgroonga_command('defrag')`
during a quiet window — 03:00 UTC is when the NAS is least
likely to be serving downloads.

#### The migration is best-effort

The standard `groonga/pgroonga` Docker image **does not bundle
pg_cron**. The migration wraps `CREATE EXTENSION pg_cron` in a
`DO … EXCEPTION` block that downgrades to a `NOTICE` when the
extension is missing, so a vanilla `groonga/pgroonga` install
still migrates cleanly. Operators who want nightly defrag must
install pg_cron separately (see below).

#### Manual install + schedule (vanilla `groonga/pgroonga` image)

If you're running a stock `groonga/pgroonga` image, install
pg_cron and schedule the job manually after `npm run migrate`:

```bash
# 1. Install pg_cron on the postgres container. The official
#    pg_cron extension requires shared_preload_libraries='pg_cron'
#    at startup; rebuild or swap the image if your image does
#    not already include it (see the docker-compose override below).
docker exec -u postgres alejandria-postgres \
  psql -d alejandria -c "CREATE EXTENSION pg_cron;"

# 2. (One time, after each migrate run) schedule the nightly
#    job — migration 011 unschedules + schedules this same
#    jobname, so re-running migrate replaces the schedule.
docker exec -u postgres alejandria-postgres psql -d alejandria <<'SQL'
SELECT cron.unschedule('alejandria_pgroonga_defrag');
SELECT cron.schedule(
  'alejandria_pgroonga_defrag',
  '0 3 * * *',
  $job$
    SELECT pgroonga_index_defrag('books_title_pgroonga_idx');
    SELECT pgroonga_index_defrag('books_excerpt_pgroonga_idx');
  $job$
);
SQL
```

#### Manual defrag (one-shot, no cron)

If pg_cron is not available, you can still defragment on
demand — the helper exists unconditionally once migration 011
has run:

```bash
docker exec -u postgres alejandria-postgres psql -d alejandria -c \
  "SELECT pgroonga_index_defrag('books_title_pgroonga_idx');"
```

#### Verify the schedule

```bash
docker exec -u postgres alejandria-postgres psql -d alejandria -c \
  "SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'alejandria_pgroonga_defrag';"
```

Expected output:

```
           jobname            | schedule  | active
------------------------------+-----------+--------
 alejandria_pgroonga_defrag   | 0 3 * * * | t
```

#### docker-compose override (auto-install pg_cron)

To avoid the manual install steps above, build a small
postgres Dockerfile that layers pg_cron on top of
`groonga/pgroonga`. See `services/nas-backend/Dockerfile.pg`
for the recipe (one extra `RUN apt-get install … postgresql-16-cron`
plus the `shared_preload_libraries` GUC in
`postgresql.conf`).

## Repositories

The data-access layer is `pg`-backed (no ORM) and lives under
[`src/repositories/`](./src/repositories). Each repository exposes
typed async methods and is unit-tested against a real Postgres +
pgroonga instance.

| Repository | Methods |
|------------|---------|
| `AuthorsRepository` | `insert`, `findById`, `list`, `count` |
| `BooksRepository` | `insert`, `findById`, `listByAuthor`, `list` (+filters incl. `libraryId`), `count`, `search`, `countByLibrary` |
| `CategoriesRepository` | `insert`, `findByPath`, `listChildren`, `listRoots`, `listForBook`, `findSubtree` (recursive CTE) |
| `SagasRepository` | `insert`, `attachBook` (idempotent), `listByAuthor`, `listForBook`, `listBooksInSaga` |
| `DownloadsRepository` | `insert`, `markCompleted`, `updateProgress`, `listByDevice`, `listForDevice` (PR-N3), `findById`, `findByBookId` (PR-N3), `findCompletedForDeviceAndBook`, `topDevicesForBook` (PR-N3), `stats` |
| `DevicesRepository` | `insert`, `findByDeviceId`, `updateTokenHash`, `touch`, `isAdmin` (PR-N3) |
| `LibrariesRepository` | `list`, `findById`, `insert`, `update`, `delete`, `setActiveForDevice`, `getActiveForDevice`, `listForDevice` |
| `SearchRepository` | `search` (pgroonga `&@~` + `pgroonga.score(tableoid)`) |

## Auth (PR-2C, hardened PR-2F.1)

The auth module issues a per-device bearer token after a one-time
PIN pairing. Every endpoint other than `GET /health`,
`GET /livez`, `GET /readyz`, `GET /api/discovery/info`,
`GET /metrics`, `POST /api/auth/pair`, and `POST /api/auth/refresh`
requires a valid `Authorization: Bearer <jwt>` header.

## Observability (PR-N7, issue #92)

The `ObservabilityModule` exposes a Prometheus-compatible metrics
endpoint at `GET /metrics`. The endpoint is intentionally
unauthenticated so scrapers (Prometheus, Grafana Agent, etc.) can
poll without managing a bearer token; operators who want to lock
it down must front it with a network-level ACL (firewall or
Tailscale ACL).

Exposed metrics:

```
http_requests_total{method,path,status}            counter
http_request_duration_seconds                      histogram
scan_jobs_total{status}                            counter
scan_job_duration_seconds                          histogram
downloads_total{state}                             counter
download_bytes                                     histogram
```

`request_id` propagation: the global request middleware honours
an inbound `X-Request-Id` header (or mints a UUID v4) and seeds
an `AsyncLocalStorage` so every Pino log line emitted during the
request carries `{request_id, route, method}`.

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
