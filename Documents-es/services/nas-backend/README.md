# alejandria-nas-backend

Aplicación NestJS que respalda el catálogo NAS de **alejandria-v2**.

> Parte de PR2 del refactor de alejandria-v2 (ver
> `openspec/changes/alejandria-v2/tasks.md` Fase 2).
>
> - **PR-2A** — scaffold + docker-compose + `GET /health`
> - **PR-2G** — resiliencia (BullMQ retry cap, mDNS error listener,
>   tabla `schema_migrations`, división `/livez` + `/readyz`,
>   timeout del scan-processor + tope de buffer)
> - **PR-2G.1** — bloqueadores de corrección + legibilidad del
>   review 4R: la query de búsqueda tiene `@MaxLength(256)` + whitelist
>   regex (#39), `HealthModule` comparte `PG_POOL` de `DatabaseModule`
>   en lugar de abrir un pool paralelo (#40), el `ValidationPipe`
>   global devuelve el envelope del proyecto (#41), `/api/downloads`
>   ya no confía en campos del body para atribución (POST deriva
>   desde el bearer, PATCH fuerza `row.device_id === bearer`,
>   `/by-device/:id` fuerza match path-vs-bearer — #42), trabajo
>   nocturno de `pg_cron` defragmentando los índices pgroonga a
>   las 03:00 UTC (#43)
> - **PR-2B** — schema Postgres, índices pgroonga, migraciones
>   idempotentes, capa de repositorios (`books`, `categories`,
>   `sagas`, `downloads`)
> - **PR-2C** — `AuthModule`, pairing de dispositivos, validación
>   JWT, ruta protegida de ejemplo (`GET /api/me`)
> - **PR-2D** — `BooksModule`, `SearchModule`
> - **PR-2E** — `DownloadsModule`, `WorkersModule` (BullMQ)
> - **PR-2F** — `DiscoveryModule` (mDNS + Tailscale)
> - **PR-N1** — `FilesModule` (`GET /api/files/:id` con HTTP Range,
>   `HEAD /api/files/:id` para descargas resumibles)
> - **PR-N2** — `LibrariesModule` (`/api/libraries/*` CRUD + active
>   library por dispositivo, scoping `books.library_id` en las
>   queries de catálogo)
> - **PR-N3** — Mejoras de tracking de descargas: `devices.is_admin`
>   (migración 015) + barrera admin en `/api/downloads/stats` y
>   `/api/downloads/by-book/:book_id` (403 `ADMIN_REQUIRED`), más
>   `GET /api/me/downloads` (scoped al caller) y la verificación de
>   privacidad en `/api/downloads/by-device/:device_id` (match
>   path-vs-bearer).
> - **PR-N4** — `ScanModule` (`/api/admin/scan/*` solo admin —
>   encolar escaneo full/incremental + listar status + cancel
>   cooperativo + streaming SSE de progreso). La tabla `scan_jobs`
>   (migración 016) es el registro durable; un worker de BullMQ
>   (cola `admin-scan`) recorre `library.root_path` de forma
>   cooperativa, observando el flag `cancelled` entre archivos.

## Stack

- **NestJS 10** (adaptador Express)
- **TypeScript 5** en modo strict con path alias `@app/*`
- **PostgreSQL 16** con la extensión **pgroonga** para full-text
  search en español / CJK (BullMQ + workers aterrizan en PR-2E)
- **Redis 7** para la cola de jobs de BullMQ
- **pg** + **ioredis** para bindings de drivers (sin ORM aún —
  la primera migración llega con PR-2B)
- **Jest 29** + **ts-jest** + **supertest** para tests end-to-end

## Layout

```
services/nas-backend/
├── src/
│   ├── main.ts                # bootstrap de NestJS
│   ├── app.module.ts          # módulo raíz (Database + Health + Auth + Me + Books + Files + Libraries + ...)
│   ├── database/              # PR-2B — Postgres pool + DatabaseModule
│   ├── repositories/          # PR-2B + PR-N2 — books, categories, sagas, downloads
│   ├── auth/                  # PR-2C — AuthModule, JWT, devices repo
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts # POST /api/auth/pair, POST /api/auth/refresh
│   │   ├── auth.service.ts    # validación de PIN, mint de JWT, hash SHA-256 del token
│   │   ├── jwt.strategy.ts    # estrategia passport-jwt
│   │   ├── jwt-auth.guard.ts  # guard de Bearer token
│   │   └── devices.repository.ts
│   ├── me/                    # PR-2C + PR-N3 — rutas scoped al caller
│   │   ├── me.module.ts
│   │   └── me.controller.ts   # GET /api/me, GET /api/me/downloads (PR-N3)
│   ├── files/                 # PR-N1 — streaming de archivos con Range
│   │   ├── files.module.ts    # wires FilesService + LIBRARY_ROOT token
│   │   ├── files.controller.ts # GET/HEAD /api/files/:book_id
│   │   ├── files.service.ts   # parseRangeHeader, resolveBookFilePath,
│   │   │                       # streamFile
│   │   └── files.types.ts     # RangeSpec, RangeParseError, FORMAT_TO_MIME
│   ├── libraries/             # PR-N2 — registro multi-library
│   │   ├── libraries.module.ts   # wires controller + service + repository
│   │   ├── libraries.controller.ts # GET/POST /api/libraries, GET/PATCH/DELETE /:id, PUT /:id/active
│   │   ├── libraries.service.ts   # authz solo-creador + LIBRARY_NOT_EMPTY
│   │   ├── libraries.repository.ts # PgLibrariesRepository + LIBRARIES_REPOSITORY token
│   │   ├── libraries.adapters.ts # PgLibraryBookCountAdapter, PgDeviceLookupAdapter
│   │   └── libraries.types.ts  # Library, NewLibrary, LibraryPatch, DeviceLibrary
│   ├── admin/                 # PR-N4 — superficies HTTP solo-admin
│   │   └── scan/              #   PR-N4 admin scan (encolar, status, cancel, SSE)
│   │       ├── scan.module.ts       # wires controller + service + repository + event bus + productor BullMQ
│   │       ├── scan.controller.ts   # POST/GET /api/admin/scan/* + SSE
│   │       ├── scan.service.ts      # orquestación de enqueue + cancel
│   │       ├── scan.repository.ts   # PgScanRepository + SCAN_REPOSITORY token
│   │       ├── scan-admin.guard.ts  # JwtAuthGuard + chequeo DEVICES_REPOSITORY.is_admin
│   │       ├── scan-event-bus.ts    # wrapper EventEmitter por jobId para fan-out SSE
│   │       └── scan.types.ts        # ScanJob, ScanJobKind, ScanJobStatus, ScanProgressEvent, NewScanJob
│   └── health/
│       ├── health.controller.ts
│       ├── health.module.ts
│       └── health.service.ts
├── migrations/                # PR-2B + PR-2C — archivos SQL idempotentes 001-010
├── scripts/
│   ├── migrate.ts             # migration runner (library)
│   └── migrate-cli.ts         # migration runner (CLI: `npm run migrate`)
```

## Admin scan (PR-N4)

PR-N4 cierra la superficie de escaneos iniciados por admin: antes
de este PR la única manera de disparar un escaneo era vía el
filesystem watcher (PR-2E). Los operadores no podían forzar un
rescaneo full, pedir un escaneo incremental sobre una library
específica, observar el progreso sin taillear BullMQ, ni cancelar
un escaneo en curso.

La tabla `scan_jobs` (migración 016) es el registro durable de
cada solicitud de escaneo admin. La capa HTTP (`/api/admin/scan/*`)
está resguardada por `JwtAuthGuard` + `ScanAdminGuard` — cada
endpoint devuelve `403 ADMIN_REQUIRED` para un dispositivo
emparejado (pero sin privilegios). El worker de BullMQ (cola
`admin-scan`) recorre `library.root_path` de forma cooperativa,
observando el flag `cancelled` entre archivos; el endpoint SSE
multiplexa el `ScanEventBus` así el cliente del iPad obtiene un
canal de progreso por job.

### Endpoints

| Método | Ruta                                   | Auth  | Status | Body                                          |
|--------|----------------------------------------|-------|--------|-----------------------------------------------|
| POST   | `/api/admin/scan/full`                 | admin | 202    | `{}` (sin library_id → escaneo whole-NAS)     |
| POST   | `/api/admin/scan/incremental`          | admin | 202    | `{ "library_id": <int> }` (requerido)         |
| GET    | `/api/admin/scan/status`               | admin | 200    | `{ jobs: ScanJobDto[] }` (más nuevo primero)  |
| GET    | `/api/admin/scan/status/:job_id`       | admin | 200/404| `{ job: ScanJobDto }` o 404 NOT_FOUND         |
| POST   | `/api/admin/scan/cancel/:job_id`       | admin | 200    | `{ cancelled: bool }` (true / false)         |
| GET    | `/api/admin/scan/events/:job_id`       | admin | 200/404| Stream SSE de objetos `ScanProgressEvent`     |

Cada endpoint que no es `events` devuelve `{ job_id }` (o el body
de respuesta apropiado) en caso de éxito. Los bearer sin admin
reciben `{ error: { code: "ADMIN_REQUIRED", message: "admin role required" } }`
con HTTP 403. Los Bearer tokens faltantes o inválidos reciben
`{ error: { code: "UNAUTHORIZED", message: "..." } }` con HTTP 401.

### Wire shapes

**`ScanJobDto`** (devuelto por `GET /status` y `GET /status/:id`):

```jsonc
{
  "id": "11111111-1111-1111-1111-111111111111",
  "library_id": 7,                  // null para escaneos whole-NAS
  "kind": "full",                   // "full" | "incremental"
  "status": "running",              // queued | running | done | cancelled | failed
  "started_at": "2026-06-29T12:00:00Z",
  "finished_at": null,
  "total_files": 1024,
  "processed_files": 256,
  "cancelled": false,
  "error": null                     // poblado cuando status == "failed"
}
```

**`ScanProgressEvent`** (payload SSE `data:`):

```jsonc
{
  "jobId": "11111111-1111-1111-1111-111111111111",
  "type": "progress",               // progress | done | cancelled | failed
  "processed": 256,
  "total": 1024,                    // null hasta que el worker termina de caminar
  "error": "...",                   // solo en "failed"
  "timestamp": "2026-06-29T12:00:01Z"
}
```

El stream SSE envía cada evento como dos líneas:

```
event: progress
data: {"jobId":"...","type":"progress","processed":256,"total":1024,"timestamp":"..."}

```

El servidor cierra la respuesta cuando:

1. El cliente se desconecta (`res.on('close')`),
2. El job alcanza un estado terminal — el bus entrega el evento
   correspondiente y se hace `res.end()`, o
3. La búsqueda inicial de la fila falla (`404 NOT_FOUND`).

Para un job que ya está en estado terminal cuando un cliente se
conecta, el controller sintetiza el evento final a partir de la
fila así los suscriptores tardíos siguen recibiendo un único evento
determinístico.

### Cancelación cooperativa

El worker chequea el flag `cancelled` entre archivos. El controller
flippea el flag vía `POST /api/admin/scan/cancel/:job_id`; el
worker lo observa en la siguiente iteración y transiciona a
`cancelled` sin tocar ningún archivo más. Una solicitud de cancel
contra un job ya en estado terminal (`done` / `failed` /
`cancelled`) devuelve `{ cancelled: false }` — flippear el flag
después de que el worker terminó competiría con el bookkeeping
del propio worker.

### Migraciones

| Migración                     | Qué agrega                                                                                              |
|-------------------------------|---------------------------------------------------------------------------------------------------------|
| `016_admin_scan_jobs.sql`     | `scan_jobs(id UUID PK, library_id BIGINT REFERENCES libraries(id) NULL, kind CHECK ('full','incremental'), status CHECK ('queued','running','done','cancelled','failed'), started_at / finished_at TIMESTAMPTZ, total_files INT, processed_files INT DEFAULT 0, cancelled BOOLEAN DEFAULT FALSE, error TEXT)`. Índices sobre `status` (endpoint admin list, loop de pickup del worker) y `library_id` (vista de historial por library). |